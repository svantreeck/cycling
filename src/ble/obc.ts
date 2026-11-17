import { Emitter, type Unsubscribe } from './trainer';

/**
 * OpenBikeControl (openbikecontrol.org) over Bluetooth: lets controllers, or BikeControl bridging a Zwift Click,
 * Ride or Play, send button presses to this app. The controller is the BLE peripheral; we connect as the central,
 * subscribe to Button State notifications, and tell it which buttons we handle via App Information.
 */

export const OBC_SERVICE = 'd273f680-d548-419d-b9d1-fa0472345229';
export const OBC_BUTTON_STATE = 'd273f681-d548-419d-b9d1-fa0472345229';
export const OBC_HAPTIC = 'd273f682-d548-419d-b9d1-fa0472345229';
export const OBC_APP_INFO = 'd273f683-d548-419d-b9d1-fa0472345229';

/** Standard button IDs from the OpenBikeControl spec that this app handles. */
export const OBC_BUTTON = {
  shiftUp: 0x01,
  shiftDown: 0x02,
  up: 0x10,
  down: 0x11,
  select: 0x14,
  back: 0x15,
  harder: 0x30,
  easier: 0x31,
  skipInterval: 0x32,
  pause: 0x33,
  resume: 0x34,
} as const;

export type ControllerAction = 'shiftUp' | 'shiftDown' | 'harder' | 'easier' | 'skip' | 'pause' | 'resume' | 'select';

const ACTION_FOR_ID: Record<number, ControllerAction> = {
  [OBC_BUTTON.shiftUp]: 'shiftUp',
  [OBC_BUTTON.shiftDown]: 'shiftDown',
  [OBC_BUTTON.up]: 'shiftUp',
  [OBC_BUTTON.down]: 'shiftDown',
  [OBC_BUTTON.harder]: 'harder',
  [OBC_BUTTON.easier]: 'easier',
  [OBC_BUTTON.skipInterval]: 'skip',
  [OBC_BUTTON.pause]: 'pause',
  [OBC_BUTTON.resume]: 'resume',
  [OBC_BUTTON.select]: 'select',
};

export const actionForButton = (id: number): ControllerAction | undefined => ACTION_FOR_ID[id];

/** Buttons we declare in App Information. */
export const SUPPORTED_BUTTONS = [
  OBC_BUTTON.shiftUp,
  OBC_BUTTON.shiftDown,
  OBC_BUTTON.select,
  OBC_BUTTON.harder,
  OBC_BUTTON.easier,
  OBC_BUTTON.skipInterval,
  OBC_BUTTON.pause,
  OBC_BUTTON.resume,
];

export interface ButtonState {
  id: number;
  /** 0 = released, 1 = pressed, 2–255 = analog strength */
  state: number;
}

/** Parse a Button State notification: [0x01, id, state, id, state, …]. Returns [] for other message types. */
export function parseButtonState(data: DataView): ButtonState[] {
  if (data.byteLength < 3 || data.getUint8(0) !== 0x01) return [];
  const out: ButtonState[] = [];
  for (let i = 1; i + 1 < data.byteLength; i += 2) out.push({ id: data.getUint8(i), state: data.getUint8(i + 1) });
  return out;
}

/** App Information: [0x04, 0x01, idLen, id…, verLen, ver…, count, buttonIds…]. */
export function encodeAppInfo(appId: string, version: string, buttons: number[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const id = enc.encode(appId.slice(0, 32));
  const ver = enc.encode(version.slice(0, 32));
  return new Uint8Array([0x04, 0x01, id.length, ...id, ver.length, ...ver, buttons.length, ...buttons]);
}

export type HapticPattern = 'single' | 'double' | 'triple' | 'long' | 'success' | 'warning' | 'error';
const HAPTIC_CODE: Record<HapticPattern, number> = { single: 1, double: 2, triple: 3, long: 4, success: 5, warning: 6, error: 7 };

/** Haptic Feedback: [0x03, pattern, duration (10 ms units, 0 = default), intensity (0 = default)]. */
export const encodeHaptic = (pattern: HapticPattern): Uint8Array<ArrayBuffer> => new Uint8Array([0x03, HAPTIC_CODE[pattern], 0x00, 0x00]);

/**
 * Tracks press/release so each physical press fires its action once, even if the controller re-sends
 * the same state or reports an analog value while held.
 */
export class PressTracker {
  private held = new Set<number>();
  /** Returns the IDs that went from released to pressed. */
  feed(states: ButtonState[]): number[] {
    const pressed: number[] = [];
    for (const { id, state } of states) {
      if (state === 0) this.held.delete(id);
      else if (!this.held.has(id)) {
        this.held.add(id);
        pressed.push(id);
      }
    }
    return pressed;
  }
  reset() {
    this.held.clear();
  }
}

export interface Controller {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onAction(cb: (a: ControllerAction) => void): Unsubscribe;
  onDisconnect(cb: () => void): Unsubscribe;
  haptic(pattern: HapticPattern): Promise<void>;
}

/** An OpenBikeControl controller (e.g. BikeControl on a phone) over Web Bluetooth. */
export class ObcController implements Controller {
  name = 'Controller';
  private device: BluetoothDevice | null = null;
  private hapticChar: BluetoothRemoteGATTCharacteristic | null = null;
  private tracker = new PressTracker();
  private actions = new Emitter<ControllerAction>();
  private disconnects = new Emitter<void>();
  private intentional = false;

  constructor(private appVersion: string) {}

  async connect(): Promise<void> {
    if (!this.device) {
      this.device = await navigator.bluetooth.requestDevice({
        // BikeControl puts the service UUID in its scan response, so also match on its name.
        filters: [{ services: [OBC_SERVICE] }, { namePrefix: 'BikeControl' }],
        optionalServices: [OBC_SERVICE],
      });
      this.name = this.device.name || 'Controller';
      this.device.addEventListener('gattserverdisconnected', () => {
        this.tracker.reset();
        if (!this.intentional) this.disconnects.emit();
      });
    }
    this.intentional = false;
    const server = await this.device.gatt!.connect();
    const svc = await server.getPrimaryService(OBC_SERVICE);
    const buttons = await svc.getCharacteristic(OBC_BUTTON_STATE);
    buttons.addEventListener('characteristicvaluechanged', (e) => {
      const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      for (const id of this.tracker.feed(parseButtonState(value))) {
        const action = actionForButton(id);
        if (action) this.actions.emit(action);
      }
    });
    await buttons.startNotifications();
    try {
      const info = await svc.getCharacteristic(OBC_APP_INFO);
      await info.writeValueWithoutResponse(encodeAppInfo('cycling-quest', this.appVersion, SUPPORTED_BUTTONS));
    } catch (e) {
      console.warn('OpenBikeControl: App Information not accepted', e); // optional per spec
    }
    try {
      this.hapticChar = await svc.getCharacteristic(OBC_HAPTIC);
    } catch {
      this.hapticChar = null;
    }
  }

  async disconnect(): Promise<void> {
    this.intentional = true;
    this.device?.gatt?.disconnect();
  }

  onAction(cb: (a: ControllerAction) => void) {
    return this.actions.on(cb);
  }

  onDisconnect(cb: () => void) {
    return this.disconnects.on(cb);
  }

  async haptic(pattern: HapticPattern): Promise<void> {
    await this.hapticChar?.writeValueWithoutResponse(encodeHaptic(pattern)).catch(() => undefined);
  }
}

/** On-screen stand-in for a controller, for development and the simulator. */
export class MockController implements Controller {
  readonly name = 'Simulated controller';
  private actions = new Emitter<ControllerAction>();
  private disconnects = new Emitter<void>();
  lastHaptic: HapticPattern | null = null;
  async connect() {}
  async disconnect() {}
  press(a: ControllerAction) {
    this.actions.emit(a);
  }
  onAction(cb: (a: ControllerAction) => void) {
    return this.actions.on(cb);
  }
  onDisconnect(cb: () => void) {
    return this.disconnects.on(cb);
  }
  async haptic(p: HapticPattern) {
    this.lastHaptic = p;
  }
}
