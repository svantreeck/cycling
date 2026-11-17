/**
 * Zwift controller BLE protocol (Zwift Click v1/v2, Play, Ride), from the community's public
 * reverse-engineering. Pure functions only, so they can be unit tested; the Web Bluetooth glue is in zwiftClick.ts.
 *
 * Flow: subscribe to ASYNC (notify) and SYNC_TX (indicate), write "RideOn" + 2 bytes to SYNC_RX.
 * An unlocked controller answers on SYNC_TX starting with 'R' (0x52); a locked Click v2 left side answers with a
 * 0xFF challenge and stops sending buttons after about a minute. Button frames arrive on ASYNC.
 */

export const ZWIFT_RIDE_SERVICE = '0000fc82-0000-1000-8000-00805f9b34fb';
export const ZWIFT_CUSTOM_SERVICE = '00000001-19ca-4651-86e5-fa29dcdd09d1';
export const ZWIFT_ASYNC = '00000002-19ca-4651-86e5-fa29dcdd09d1';
export const ZWIFT_SYNC_RX = '00000003-19ca-4651-86e5-fa29dcdd09d1';
export const ZWIFT_SYNC_TX = '00000004-19ca-4651-86e5-fa29dcdd09d1';
/** Bluetooth company ID for Zwift, Inc. (in manufacturer data). */
export const ZWIFT_COMPANY_ID = 0x094a;

export const RIDE_ON = [0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e]; // "RideOn"
/** Handshake: "RideOn" + two bytes. Click v2 / Ride use 02 03; the trailing bytes reportedly don't matter. */
export const handshake = (v2: boolean) => new Uint8Array([...RIDE_ON, ...(v2 ? [0x02, 0x03] : [0x01, 0x03])]);

/** Frame types (first byte of an ASYNC notification). */
export const FRAME = {
  rideButtons: 0x23, // Ride / Click v2 / Play fw2: protobuf RideKeyPadStatus
  clickV1Buttons: 0x37, // original Click: two varints (plus, minus), 0 = pressed
  playButtons: 0x07, // Play (fw1)
  battery: 0x19,
  empty: 0x15,
  rideOn: 0x52,
} as const;

/** Button bits in the Ride/Click v2 button map. The map uses inverse logic: a 0 bit means pressed. */
export const ZWIFT_BTN = {
  left: 0x0001,
  up: 0x0002,
  right: 0x0004,
  down: 0x0008,
  a: 0x0010,
  b: 0x0020,
  y: 0x0040,
  z: 0x0080,
  shiftUpLeft: 0x0100, // Click v2 left "−"
  shiftDownLeft: 0x0200,
  powerUpLeft: 0x0400,
  onOffLeft: 0x0800,
  shiftUpRight: 0x1000, // Click v2 right "+"
  shiftDownRight: 0x2000,
  powerUpRight: 0x4000,
  onOffRight: 0x8000,
} as const;

export type ZwiftButton = keyof typeof ZWIFT_BTN;

export const BUTTON_LABEL: Record<ZwiftButton, string> = {
  left: '◀ (left)',
  up: '▲ (left)',
  right: '▶ (left)',
  down: '▼ (left)',
  a: 'A',
  b: 'B',
  y: 'Y',
  z: 'Z',
  shiftUpLeft: '− (left)',
  shiftDownLeft: 'shift down (left)',
  powerUpLeft: 'power-up (left)',
  onOffLeft: 'power (left)',
  shiftUpRight: '+ (right)',
  shiftDownRight: 'shift down (right)',
  powerUpRight: 'power-up (right)',
  onOffRight: 'power (right)',
};

/** Read a protobuf varint at `pos`. Returns the value (safe up to 2^53) and the next position. */
export function readVarint(bytes: Uint8Array, pos: number): { value: number; next: number } {
  let value = 0;
  let scale = 1;
  for (let i = 0; i < 10 && pos < bytes.length; i++) {
    const b = bytes[pos++];
    value += (b & 0x7f) * scale;
    if ((b & 0x80) === 0) return { value, next: pos };
    scale *= 128;
  }
  throw new Error('truncated varint');
}

/** Top-level protobuf fields of a message: varints by field number (length-delimited fields are skipped). */
export function protobufVarints(bytes: Uint8Array): Map<number, number> {
  const out = new Map<number, number>();
  let pos = 0;
  while (pos < bytes.length) {
    const key = readVarint(bytes, pos);
    pos = key.next;
    const field = Math.floor(key.value / 8);
    const wire = key.value & 7;
    if (wire === 0) {
      const v = readVarint(bytes, pos);
      out.set(field, v.value);
      pos = v.next;
    } else if (wire === 2) {
      const len = readVarint(bytes, pos);
      pos = len.next + len.value;
    } else if (wire === 5) pos += 4;
    else if (wire === 1) pos += 8;
    else break; // unknown wire type: stop rather than misparse
  }
  return out;
}

export type ZwiftFrame =
  | { kind: 'buttons'; pressed: number }
  | { kind: 'battery'; level: number }
  | { kind: 'other'; type: number };

/** Decode an ASYNC notification. `pressed` is a mask of ZWIFT_BTN bits currently held down. */
export function parseZwiftFrame(bytes: Uint8Array): ZwiftFrame {
  if (bytes.length === 0) return { kind: 'other', type: -1 };
  const type = bytes[0];
  const body = bytes.subarray(1);
  try {
    if (type === FRAME.rideButtons || type === FRAME.playButtons) {
      const map = protobufVarints(body).get(1);
      if (map == null) return { kind: 'other', type };
      return { kind: 'buttons', pressed: ~map & 0xffff };
    }
    if (type === FRAME.clickV1Buttons) {
      const f = protobufVarints(body);
      let pressed = 0;
      if (f.get(1) === 0) pressed |= ZWIFT_BTN.shiftUpRight; // plus
      if (f.get(2) === 0) pressed |= ZWIFT_BTN.shiftUpLeft; // minus
      return { kind: 'buttons', pressed };
    }
    if (type === FRAME.battery) {
      const level = protobufVarints(body).get(1);
      if (level != null) return { kind: 'battery', level };
    }
  } catch {
    /* fall through */
  }
  return { kind: 'other', type };
}

/** SYNC_TX reply to the handshake: 'R…' = unlocked, 0xFF… = locked challenge. */
export function handshakeReply(bytes: Uint8Array): 'unlocked' | 'locked' | 'unknown' {
  if (bytes[0] === 0x52) return 'unlocked';
  if (bytes[0] === 0xff) return 'locked';
  return 'unknown';
}

/** Bits that went from released to pressed. */
export const newlyPressed = (prev: number, next: number) => next & ~prev;

export const buttonsIn = (mask: number): ZwiftButton[] =>
  (Object.keys(ZWIFT_BTN) as ZwiftButton[]).filter((b) => (mask & ZWIFT_BTN[b]) !== 0);

export const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
