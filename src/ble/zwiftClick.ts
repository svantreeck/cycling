import type { ControllerAction, Controller } from './controller';
import { requestDeviceCompat, writeWithoutResponse, writeWithResponse } from './gatt';
import { Emitter } from './trainer';
import {
  BUTTON_LABEL,
  buttonsIn,
  handshake,
  handshakeReply,
  newlyPressed,
  parseZwiftFrame,
  toHex,
  ZWIFT_ASYNC,
  ZWIFT_BTN,
  ZWIFT_COMPANY_ID,
  ZWIFT_CUSTOM_SERVICE,
  ZWIFT_RIDE_SERVICE,
  ZWIFT_SYNC_RX,
  ZWIFT_SYNC_TX,
  type ZwiftButton,
} from './zwiftProtocol';

/**
 * Direct Web Bluetooth support for Zwift Click (v1 and v2) and Zwift Ride/Play controllers.
 * A Click v2 is two devices (left "−" pod, right "+" pod); each is added with its own Bluetooth prompt.
 *
 * The right side never needs Zwift's unlock. The left side locks (stops sending after about a minute) unless the
 * Zwift app unlocked it within roughly 24 h, so the right side alone covers both directions: + shifts up, B shifts down.
 */

/** What each button does. Right side (+ and the face buttons) shifts up; left side (−) shifts down. */
export const BUTTON_ACTIONS: Partial<Record<ZwiftButton, ControllerAction>> = {
  shiftUpRight: 'shiftUp',
  shiftDownRight: 'shiftUp',
  shiftUpLeft: 'shiftDown',
  shiftDownLeft: 'shiftDown',
  b: 'shiftDown', // so the right side alone can shift both ways
  a: 'select',
  y: 'harder',
  z: 'easier',
  up: 'harder',
  down: 'easier',
  left: 'pause',
  right: 'skip',
};

export type PodSide = 'left' | 'right' | 'unknown';
export type PodState = 'connecting' | 'connected' | 'reconnecting' | 'lost';

export interface PodInfo {
  id: string;
  name: string;
  side: PodSide;
  state: PodState;
  lock: 'unlocked' | 'locked' | 'unknown';
  battery: number | null;
  lastButtonAt: number | null;
}

export interface LogLine {
  at: number;
  pod: string;
  dir: 'in' | 'out' | 'info';
  text: string;
}

const KEEPALIVE_MS = 3000;
/** Same action twice within this window is treated as one press. Fast deliberate taps are ~150 ms+ apart. */
export const DEBOUNCE_MS = 100;
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const LOG_MAX = 300;

const LEFT_BITS = ZWIFT_BTN.left | ZWIFT_BTN.up | ZWIFT_BTN.right | ZWIFT_BTN.down | ZWIFT_BTN.shiftUpLeft | ZWIFT_BTN.shiftDownLeft | ZWIFT_BTN.powerUpLeft | ZWIFT_BTN.onOffLeft;

class Pod {
  info: PodInfo;
  private rx: BluetoothRemoteGATTCharacteristic | null = null;
  private keepalive: ReturnType<typeof setInterval> | null = null;
  private pressed = 0;
  private intentional = false;
  private reconnectAttempt = 0;
  // Stable handler references: adding the same listener twice is a no-op, so reconnecting (or picking an
  // already-connected side again) can't stack listeners and fire every press twice.
  private readonly handleAsync = (e: Event) => this.onAsync(bytesOf(e));
  private readonly handleSyncTx = (e: Event) => this.onSyncTx(bytesOf(e));

  constructor(
    readonly device: BluetoothDevice,
    private owner: ZwiftClickController,
  ) {
    this.info = { id: device.id, name: device.name || 'Zwift controller', side: 'unknown', state: 'connecting', lock: 'unknown', battery: null, lastButtonAt: null };
    device.addEventListener('gattserverdisconnected', () => this.onDisconnected());
  }

  private log(dir: LogLine['dir'], text: string) {
    this.owner.addLog({ at: Date.now(), pod: this.label(), dir, text });
  }

  label() {
    return this.info.side === 'unknown' ? this.info.name : `${this.info.name} (${this.info.side})`;
  }

  async connect() {
    this.intentional = false;
    this.set({ state: this.info.state === 'connected' ? 'connected' : this.reconnectAttempt ? 'reconnecting' : 'connecting' });
    const server = await this.device.gatt!.connect();
    let service: BluetoothRemoteGATTService;
    let v2 = true;
    try {
      service = await server.getPrimaryService(ZWIFT_RIDE_SERVICE);
    } catch {
      service = await server.getPrimaryService(ZWIFT_CUSTOM_SERVICE);
      v2 = false;
    }
    this.log('info', `connected, service ${v2 ? 'fc82 (Ride/Click v2)' : '0001 (Click v1/Play)'}`);

    const asyncChar = await service.getCharacteristic(ZWIFT_ASYNC);
    const txChar = await service.getCharacteristic(ZWIFT_SYNC_TX);
    this.rx = await service.getCharacteristic(ZWIFT_SYNC_RX);

    asyncChar.addEventListener('characteristicvaluechanged', this.handleAsync);
    txChar.addEventListener('characteristicvaluechanged', this.handleSyncTx);
    await asyncChar.startNotifications();
    await txChar.startNotifications();

    await this.write(handshake(v2), 'handshake');
    // Harmless on a locked controller; keeps an unlocked left side unlocked.
    await this.write(new Uint8Array([0xff, 0x04, 0x00]), 'unlock-ack');

    // Re-send RideOn every few seconds: stops the Click v2 right side deep-sleeping after ~1 minute idle.
    this.stopKeepalive();
    this.keepalive = setInterval(() => void this.write(handshake(v2), 'keepalive', true), KEEPALIVE_MS);

    this.reconnectAttempt = 0;
    this.set({ state: 'connected' });
  }

  async disconnect() {
    this.intentional = true;
    this.stopKeepalive();
    this.device.gatt?.disconnect();
    this.set({ state: 'lost' });
  }

  private async write(bytes: Uint8Array<ArrayBuffer>, what: string, quiet = false) {
    if (!this.rx) return;
    try {
      await writeWithResponse(this.rx, bytes);
      if (!quiet) this.log('out', `${what}: ${toHex(bytes)}`);
    } catch (e) {
      try {
        await writeWithoutResponse(this.rx, bytes);
        if (!quiet) this.log('out', `${what} (no response): ${toHex(bytes)}`);
      } catch {
        this.log('info', `${what} write failed: ${(e as Error).message}`);
      }
    }
  }

  private onSyncTx(bytes: Uint8Array) {
    const reply = handshakeReply(bytes);
    if (reply !== 'unknown' && reply !== this.info.lock) {
      this.set({ lock: reply });
      this.log('info', reply === 'locked' ? 'LOCKED (Zwift unlock needed for this side; it may stop after ~1 min)' : 'unlocked');
    }
    this.log('in', `sync: ${toHex(bytes)}`);
  }

  private onAsync(bytes: Uint8Array) {
    const frame = parseZwiftFrame(bytes);
    if (frame.kind === 'buttons') {
      const fresh = newlyPressed(this.pressed, frame.pressed);
      this.pressed = frame.pressed;
      if (frame.pressed) {
        this.log('in', `${toHex(bytes)} → held: ${buttonsIn(frame.pressed).map((b) => BUTTON_LABEL[b]).join(', ')}`);
      }
      if (fresh) {
        // Learn which side this pod is from the buttons it sends.
        if (this.info.side === 'unknown') this.set({ side: fresh & LEFT_BITS ? 'left' : 'right' });
        this.set({ lastButtonAt: Date.now() });
        // One action per frame, even if a press sets two bits that map to the same action.
        const actions = new Set<ControllerAction>();
        for (const b of buttonsIn(fresh)) {
          const action = BUTTON_ACTIONS[b];
          this.owner.emitButton(b, action);
          if (action) actions.add(action);
        }
        for (const a of actions) this.owner.emitAction(a);
      }
      return;
    }
    if (frame.kind === 'battery') {
      this.set({ battery: frame.level });
      return;
    }
    if (frame.type !== 0x15) this.log('in', `type 0x${frame.type.toString(16)}: ${toHex(bytes)}`);
  }

  private onDisconnected() {
    this.stopKeepalive();
    this.pressed = 0;
    if (this.intentional) return;
    this.log('info', 'disconnected; reconnecting');
    this.set({ state: 'reconnecting' });
    void this.reconnectLoop();
  }

  private async reconnectLoop() {
    while (!this.intentional) {
      const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
      this.reconnectAttempt++;
      await new Promise((r) => setTimeout(r, delay));
      if (this.intentional) return;
      try {
        await this.connect();
        this.log('info', `reconnected after ${this.reconnectAttempt} attempt(s)`);
        return;
      } catch (e) {
        if (this.reconnectAttempt === 3) this.log('info', `still reconnecting: ${(e as Error).message}`);
        if (this.reconnectAttempt > 30) {
          this.set({ state: 'lost' });
          this.log('info', 'gave up reconnecting');
          return;
        }
      }
    }
  }

  private stopKeepalive() {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
  }

  private set(patch: Partial<PodInfo>) {
    this.info = { ...this.info, ...patch };
    this.owner.changed();
  }
}

const bytesOf = (e: Event) => {
  const v = (e.target as BluetoothRemoteGATTCharacteristic).value!;
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
};

/** One or more Zwift controller pods acting as a single controller. */
export class ZwiftClickController implements Controller {
  readonly name = 'Zwift Click';
  private pods: Pod[] = [];
  private actions = new Emitter<ControllerAction>();
  private disconnects = new Emitter<void>();
  private changes = new Emitter<void>();
  private buttons = new Emitter<{ button: ZwiftButton; action?: ControllerAction }>();
  private logLines: LogLine[] = [];

  /** Prompt for a pod and connect it. Call again to add the other side. */
  async connect(): Promise<void> {
    const optionalServices = [ZWIFT_RIDE_SERVICE, ZWIFT_CUSTOM_SERVICE];
    const device = await requestDeviceCompat([
      { filters: [{ manufacturerData: [{ companyIdentifier: ZWIFT_COMPANY_ID }] }, { namePrefix: 'Zwift' }], optionalServices },
      // iOS Web Bluetooth browsers may not support manufacturerData filters.
      { filters: [{ namePrefix: 'Zwift' }], optionalServices },
    ]);
    let pod = this.pods.find((p) => p.device.id === device.id);
    if (pod?.info.state === 'connected') {
      this.addLog({ at: Date.now(), pod: pod.label(), dir: 'info', text: 'already connected (pick the other side to add it)' });
      return;
    }
    if (!pod) {
      pod = new Pod(device, this);
      this.pods.push(pod);
    }
    try {
      await pod.connect();
    } catch (e) {
      this.pods = this.pods.filter((p) => p !== pod);
      this.changed();
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    await Promise.all(this.pods.map((p) => p.disconnect()));
    this.pods = [];
    this.changed();
  }

  async removePod(id: string) {
    const pod = this.pods.find((p) => p.info.id === id);
    await pod?.disconnect();
    this.pods = this.pods.filter((p) => p !== pod);
    this.changed();
    if (!this.pods.length) this.disconnects.emit();
  }

  get podInfo(): PodInfo[] {
    return this.pods.map((p) => p.info);
  }

  get log(): LogLine[] {
    return this.logLines;
  }

  onAction(cb: (a: ControllerAction) => void) {
    return this.actions.on(cb);
  }
  onDisconnect(cb: () => void) {
    return this.disconnects.on(cb);
  }
  onChange(cb: () => void) {
    return this.changes.on(cb);
  }
  /** Every press, including buttons with no action (for the button tester). */
  onButton(cb: (e: { button: ZwiftButton; action?: ControllerAction }) => void) {
    return this.buttons.on(cb);
  }


  private lastActionAt = new Map<ControllerAction, number>();

  /** @internal Report a press to the button tester. */
  emitButton(button: ZwiftButton, action?: ControllerAction) {
    this.buttons.emit({ button, action });
  }

  /** @internal Fire an action, ignoring repeats of the same action within DEBOUNCE_MS (switch bounce). */
  emitAction(action: ControllerAction, now = Date.now()) {
    const last = this.lastActionAt.get(action);
    if (last != null && now - last < DEBOUNCE_MS) return;
    this.lastActionAt.set(action, now);
    this.actions.emit(action);
  }
  /** @internal */
  addLog(line: LogLine) {
    this.logLines = [...this.logLines.slice(-(LOG_MAX - 1)), line];
    this.changes.emit();
  }
  /** @internal */
  changed() {
    this.changes.emit();
  }
}

/**
 * Diagnostic: connect to any Bluetooth device (e.g. the KICKR, to see whether it relays a paired Click), list its
 * services and characteristics, and log every notification from Zwift services. Optionally send the RideOn
 * handshake. Output goes to `log`.
 */
export async function inspectDevice(log: (text: string) => void, sendRideOn: boolean): Promise<void> {
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [
      ZWIFT_RIDE_SERVICE,
      ZWIFT_CUSTOM_SERVICE,
      '00001826-0000-1000-8000-00805f9b34fb', // FTMS
      '00001818-0000-1000-8000-00805f9b34fb', // Cycling Power
      'a026ee0b-0a7d-4ab3-97fa-f1500f9feb8b', // Wahoo (unconfirmed)
      'a026ee0d-0a7d-4ab3-97fa-f1500f9feb8b', // Wahoo (unconfirmed)
    ],
  });
  log(`inspecting ${device.name ?? device.id}`);
  const server = await device.gatt!.connect();
  const services = await server.getPrimaryServices();
  for (const s of services) {
    const chars = await s.getCharacteristics().catch(() => [] as BluetoothRemoteGATTCharacteristic[]);
    log(`service ${s.uuid}: ${chars.map((c) => `${c.uuid.slice(0, 8)}[${props(c)}]`).join(' ')}`);
    const zwift = s.uuid === ZWIFT_RIDE_SERVICE || s.uuid === ZWIFT_CUSTOM_SERVICE;
    if (!zwift) continue;
    for (const c of chars) {
      if (c.properties.notify || c.properties.indicate) {
        c.addEventListener('characteristicvaluechanged', (e) => log(`${c.uuid.slice(0, 8)} ← ${toHex(bytesOf(e))}`));
        await c.startNotifications().catch((e) => log(`notify ${c.uuid.slice(0, 8)} failed: ${(e as Error).message}`));
      }
    }
    const rx = chars.find((c) => c.uuid === ZWIFT_SYNC_RX);
    if (sendRideOn && rx) {
      await writeWithResponse(rx, handshake(true)).then(
        () => log('sent RideOn'),
        (e) => log(`RideOn failed: ${(e as Error).message}`),
      );
    }
  }
}

const props = (c: BluetoothRemoteGATTCharacteristic) =>
  [c.properties.read && 'r', c.properties.write && 'w', c.properties.writeWithoutResponse && 'W', c.properties.notify && 'n', c.properties.indicate && 'i']
    .filter(Boolean)
    .join('');
