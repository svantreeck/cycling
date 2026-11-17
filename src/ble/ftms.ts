import { Emitter, type Trainer, type TrainerCapabilities, type TrainerSample } from './trainer';
import {
  CPS_MEASUREMENT,
  CPS_SERVICE,
  FTMS_CONTROL_POINT,
  FTMS_SERVICE,
  INDOOR_BIKE_DATA,
  OP_SET_TARGET_POWER,
  cadenceFromCrank,
  encodeRequestControl,
  encodeSetSimulation,
  encodeSetTargetPower,
  encodeStart,
  parseControlPointResponse,
  parseCyclingPowerMeasurement,
  parseIndoorBikeData,
} from './ftmsParsers';

import { writeWithResponse } from './gatt';

export const isWebBluetoothAvailable = () =>
  typeof navigator !== 'undefined' && 'bluetooth' in navigator;

const ERG_MIN_INTERVAL_MS = 1000;
const RESPONSE_TIMEOUT_MS = 3000;

/**
 * Smart trainer over Web Bluetooth. Prefers FTMS (read + control); falls back to
 * the Cycling Power Service (read-only) on older firmware.
 */
export class BluetoothTrainer implements Trainer {
  kind: 'ftms' | 'cps' = 'ftms';
  capabilities: TrainerCapabilities = { erg: false, simulation: false };

  private device: BluetoothDevice | null = null;
  private controlPoint: BluetoothRemoteGATTCharacteristic | null = null;
  private samples = new Emitter<TrainerSample>();
  private disconnects = new Emitter<void>();
  private writeChain: Promise<unknown> = Promise.resolve();
  private pendingResponse: { op: number; resolve: (ok: boolean) => void } | null = null;
  private intentionalDisconnect = false;

  // ERG coalescing: only the most recent target matters.
  private ergTarget: number | null = null;
  private lastErgWrite = 0;
  private ergTimer: ReturnType<typeof setTimeout> | null = null;

  // CPS cadence derivation
  private lastCrank: { revs: number; time: number; at: number } | null = null;
  private lastCadence = 0;

  get name() {
    return this.device?.name ?? 'Smart trainer';
  }

  async connect(): Promise<void> {
    if (!isWebBluetoothAvailable()) throw new Error('Web Bluetooth is not available in this browser.');
    if (!this.device) {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [FTMS_SERVICE] }, { services: [CPS_SERVICE] }, { namePrefix: 'KICKR' }],
        optionalServices: [FTMS_SERVICE, CPS_SERVICE],
      });
      this.device.addEventListener('gattserverdisconnected', this.handleDisconnect);
    }
    this.intentionalDisconnect = false;
    const server = await this.device.gatt!.connect();

    let ftms: BluetoothRemoteGATTService | null = null;
    try {
      ftms = await server.getPrimaryService(FTMS_SERVICE);
    } catch {
      ftms = null;
    }

    if (ftms) {
      this.kind = 'ftms';
      const data = await ftms.getCharacteristic(INDOOR_BIKE_DATA);
      data.addEventListener('characteristicvaluechanged', this.handleBikeData);
      await data.startNotifications();

      try {
        this.controlPoint = await ftms.getCharacteristic(FTMS_CONTROL_POINT);
        this.controlPoint.addEventListener('characteristicvaluechanged', this.handleControlResponse);
        await this.controlPoint.startNotifications();
        const gotControl = await this.write(encodeRequestControl(), 0x00);
        if (gotControl) {
          await this.write(encodeStart(), 0x07);
          this.capabilities = { erg: true, simulation: true };
          await this.setFreeRide();
        }
      } catch (e) {
        console.warn('FTMS control point unavailable; read-only mode', e);
        this.controlPoint = null;
        this.capabilities = { erg: false, simulation: false };
      }
    } else {
      this.kind = 'cps';
      this.capabilities = { erg: false, simulation: false };
      const cps = await server.getPrimaryService(CPS_SERVICE);
      const meas = await cps.getCharacteristic(CPS_MEASUREMENT);
      meas.addEventListener('characteristicvaluechanged', this.handleCpsData);
      await meas.startNotifications();
    }
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    try {
      if (this.capabilities.simulation) await this.setFreeRide();
    } catch {
      /* ignore */
    }
    this.clearErgTimer();
    this.device?.gatt?.disconnect();
  }

  onSample(cb: (s: TrainerSample) => void) {
    return this.samples.on(cb);
  }

  onDisconnect(cb: () => void) {
    return this.disconnects.on(cb);
  }

  async setErgPower(watts: number): Promise<void> {
    if (!this.capabilities.erg) return;
    this.ergTarget = Math.round(watts);
    const wait = this.lastErgWrite + ERG_MIN_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      await this.flushErg();
    } else if (!this.ergTimer) {
      this.ergTimer = setTimeout(() => {
        this.ergTimer = null;
        void this.flushErg();
      }, wait);
    }
  }

  async setFreeRide(gradePct = 0): Promise<void> {
    if (!this.capabilities.simulation) return;
    this.ergTarget = null;
    this.clearErgTimer();
    await this.write(encodeSetSimulation({ gradePct }), 0x11);
  }

  // ---- internals ----------------------------------------------------------

  private async flushErg() {
    if (this.ergTarget == null) return;
    this.lastErgWrite = Date.now();
    await this.write(encodeSetTargetPower(this.ergTarget), OP_SET_TARGET_POWER);
  }

  private clearErgTimer() {
    if (this.ergTimer) clearTimeout(this.ergTimer);
    this.ergTimer = null;
  }

  /** Serialized write-with-response; resolves true when the trainer acknowledges success. */
  private write(bytes: Uint8Array, op: number): Promise<boolean> {
    const run = async () => {
      const cp = this.controlPoint;
      if (!cp) return false;
      const response = new Promise<boolean>((resolve) => {
        this.pendingResponse = { op, resolve };
        setTimeout(() => {
          if (this.pendingResponse?.resolve === resolve) {
            this.pendingResponse = null;
            resolve(false);
          }
        }, RESPONSE_TIMEOUT_MS);
      });
      await writeWithResponse(cp, bytes as BufferSource);
      return response;
    };
    const p = this.writeChain.then(run, run);
    this.writeChain = p.catch(() => undefined);
    return p;
  }

  private handleControlResponse = (ev: Event) => {
    const dv = (ev.target as BluetoothRemoteGATTCharacteristic).value!;
    const res = parseControlPointResponse(dv);
    if (res && this.pendingResponse && this.pendingResponse.op === res.requestOp) {
      this.pendingResponse.resolve(res.success);
      this.pendingResponse = null;
    }
  };

  private handleBikeData = (ev: Event) => {
    const dv = (ev.target as BluetoothRemoteGATTCharacteristic).value!;
    const d = parseIndoorBikeData(dv);
    this.samples.emit({
      t: Date.now(),
      power: Math.max(0, d.power ?? 0),
      cadence: d.cadence ?? 0,
      speedKph: d.speedKph ?? 0,
    });
  };

  private handleCpsData = (ev: Event) => {
    const dv = (ev.target as BluetoothRemoteGATTCharacteristic).value!;
    const m = parseCyclingPowerMeasurement(dv);
    const now = Date.now();
    if (m.crankRevs != null && m.crankEventTime != null) {
      const cur = { revs: m.crankRevs, time: m.crankEventTime, at: now };
      if (this.lastCrank && cur.time !== this.lastCrank.time) {
        const c = cadenceFromCrank(this.lastCrank, cur);
        if (c != null && c < 250) this.lastCadence = c;
        this.lastCrank = cur;
      } else if (!this.lastCrank) {
        this.lastCrank = cur;
      }
      if (now - this.lastCrank.at > 3000) this.lastCadence = 0;
    }
    this.samples.emit({ t: now, power: Math.max(0, m.power), cadence: this.lastCadence, speedKph: 0 });
  };

  private handleDisconnect = () => {
    this.controlPoint = null;
    this.clearErgTimer();
    if (this.pendingResponse) {
      this.pendingResponse.resolve(false);
      this.pendingResponse = null;
    }
    if (!this.intentionalDisconnect) this.disconnects.emit();
  };
}
