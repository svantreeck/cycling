import { uuid16 } from './ftmsParsers';
import { Emitter, type Unsubscribe } from './trainer';

/** Standard Bluetooth Heart Rate service: chest straps, arm bands and watches in broadcast mode. */
export const HR_SERVICE = uuid16(0x180d);
export const HR_MEASUREMENT = uuid16(0x2a37);

/**
 * Heart Rate Measurement (0x2A37): flags byte, then the rate as uint8 (flag bit 0 clear) or uint16 little-endian
 * (bit 0 set). Energy expended and RR intervals may follow; they're not needed here. Returns null for a zero or
 * malformed reading (straps send 0 while they're not on skin).
 */
export function parseHeartRate(dv: DataView): number | null {
  if (dv.byteLength < 2) return null;
  const flags = dv.getUint8(0);
  const wide = (flags & 0x01) !== 0;
  if (wide && dv.byteLength < 3) return null;
  const bpm = wide ? dv.getUint16(1, true) : dv.getUint8(1);
  return bpm > 0 && bpm < 255 ? bpm : null;
}

export type HrState = 'connecting' | 'connected' | 'reconnecting' | 'lost';

export interface HeartRateSource {
  readonly name: string;
  readonly kind: 'ble' | 'mock';
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onHeartRate(cb: (bpm: number) => void): Unsubscribe;
  onState(cb: (s: HrState) => void): Unsubscribe;
}

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

/** A Bluetooth heart-rate monitor. Reconnects by itself if the strap drops out mid-ride. */
export class HeartRateMonitor implements HeartRateSource {
  readonly kind = 'ble';
  private device: BluetoothDevice | null = null;
  private rates = new Emitter<number>();
  private states = new Emitter<HrState>();
  private intentional = false;
  private attempt = 0;
  private readonly handleValue = (e: Event) => {
    const bpm = parseHeartRate((e.target as BluetoothRemoteGATTCharacteristic).value!);
    if (bpm != null) this.rates.emit(bpm);
  };
  private readonly handleDisconnect = () => void this.onDropped();

  /**
   * `source.device`: an already-permitted device (automatic reconnect, no prompt).
   * `source.name`: show the picker filtered to just this device name (one-tap reconnect).
   */
  constructor(private source: { device?: BluetoothDevice; name?: string } = {}) {}

  get name() {
    return this.device?.name ?? this.source.device?.name ?? this.source.name ?? 'Heart rate monitor';
  }

  get identity(): { id: string; name: string } | null {
    return this.device ? { id: this.device.id, name: this.device.name ?? 'Heart rate monitor' } : null;
  }

  async connect(): Promise<void> {
    if (!this.device) {
      this.device =
        this.source.device ??
        (await navigator.bluetooth.requestDevice({
          filters: this.source.name ? [{ name: this.source.name }] : [{ services: [HR_SERVICE] }],
          optionalServices: [HR_SERVICE],
        }));
      this.device.addEventListener('gattserverdisconnected', this.handleDisconnect);
    }
    this.intentional = false;
    const server = await this.device.gatt!.connect();
    const service = await server.getPrimaryService(HR_SERVICE);
    const ch = await service.getCharacteristic(HR_MEASUREMENT);
    ch.addEventListener('characteristicvaluechanged', this.handleValue);
    await ch.startNotifications();
    this.attempt = 0;
    this.states.emit('connected');
  }

  async disconnect(): Promise<void> {
    this.intentional = true;
    this.device?.gatt?.disconnect();
  }

  private async onDropped() {
    if (this.intentional) return;
    while (this.attempt < RECONNECT_DELAYS_MS.length) {
      this.states.emit('reconnecting');
      await new Promise((r) => setTimeout(r, RECONNECT_DELAYS_MS[this.attempt++]));
      if (this.intentional) return;
      try {
        await this.connect();
        return;
      } catch {
        /* try again */
      }
    }
    this.states.emit('lost');
  }

  onHeartRate(cb: (bpm: number) => void) {
    return this.rates.on(cb);
  }

  onState(cb: (s: HrState) => void) {
    return this.states.on(cb);
  }
}

/** Simulated heart rate that drifts toward a level set by the rider's power, like a real heart lagging effort. */
export class MockHeartRate implements HeartRateSource {
  readonly kind = 'mock';
  readonly name = 'Simulated heart rate';
  private rates = new Emitter<number>();
  private states = new Emitter<HrState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private bpm = 70;

  constructor(private power: () => number) {}

  async connect() {
    this.timer = setInterval(() => {
      const target = Math.min(190, 70 + this.power() * 0.45);
      this.bpm += (target - this.bpm) / 15;
      this.rates.emit(Math.round(this.bpm));
    }, 1000);
    this.states.emit('connected');
  }

  async disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onHeartRate(cb: (bpm: number) => void) {
    return this.rates.on(cb);
  }

  onState(cb: (s: HrState) => void) {
    return this.states.on(cb);
  }
}
