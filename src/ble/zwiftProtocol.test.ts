import { BUTTON_ACTIONS, DEBOUNCE_MS, ZwiftClickController } from './zwiftClick';
import { buttonsIn, handshake, handshakeReply, newlyPressed, parseZwiftFrame, protobufVarints, readVarint, ZWIFT_BTN } from './zwiftProtocol';

/** Encode a varint the way protobuf does. */
const varint = (n: number) => {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
};
/** A 0x23 button frame with the given buttons held (inverse logic: held bits are 0). */
const rideFrame = (held: number) => new Uint8Array([0x23, 0x08, ...varint((0xffffffff & ~held) >>> 0)]);

describe('Zwift controller protocol', () => {
  it('reads varints, including 32-bit ones', () => {
    expect(readVarint(new Uint8Array([0x96, 0x01]), 0)).toEqual({ value: 150, next: 2 });
    expect(readVarint(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x0f]), 0).value).toBe(0xffffffff);
  });

  it('collects top-level protobuf varints and skips length-delimited fields', () => {
    // field 1 = 5, field 3 = bytes [0x08 0x01], field 2 = 7
    const f = protobufVarints(new Uint8Array([0x08, 0x05, 0x1a, 0x02, 0x08, 0x01, 0x10, 0x07]));
    expect(f.get(1)).toBe(5);
    expect(f.get(2)).toBe(7);
    expect(f.has(3)).toBe(false);
  });

  it('decodes the all-released frame as nothing pressed', () => {
    expect(parseZwiftFrame(new Uint8Array([0x23, 0x08, 0xff, 0xff, 0xff, 0xff, 0x0f]))).toEqual({ kind: 'buttons', pressed: 0 });
  });

  it('decodes Click v2 + (right) and − (left) presses', () => {
    expect(parseZwiftFrame(rideFrame(ZWIFT_BTN.shiftUpRight))).toEqual({ kind: 'buttons', pressed: ZWIFT_BTN.shiftUpRight });
    expect(parseZwiftFrame(rideFrame(ZWIFT_BTN.shiftUpLeft))).toEqual({ kind: 'buttons', pressed: ZWIFT_BTN.shiftUpLeft });
    const both = parseZwiftFrame(rideFrame(ZWIFT_BTN.a | ZWIFT_BTN.b));
    expect(both.kind === 'buttons' && buttonsIn(both.pressed)).toEqual(['a', 'b']);
  });

  it('matches the byte positions other projects use for the Click v2 (byte 3 = 0xdf for +)', () => {
    const f = rideFrame(ZWIFT_BTN.shiftUpRight);
    expect(f[3]).toBe(0xdf);
    expect(rideFrame(ZWIFT_BTN.shiftUpLeft)[3]).toBe(0xfd);
  });

  it('decodes original Click (0x37) frames: 0 = pressed', () => {
    expect(parseZwiftFrame(new Uint8Array([0x37, 0x08, 0x00, 0x10, 0x01]))).toEqual({ kind: 'buttons', pressed: ZWIFT_BTN.shiftUpRight });
    expect(parseZwiftFrame(new Uint8Array([0x37, 0x08, 0x01, 0x10, 0x00]))).toEqual({ kind: 'buttons', pressed: ZWIFT_BTN.shiftUpLeft });
  });

  it('decodes battery and ignores unknown frames', () => {
    expect(parseZwiftFrame(new Uint8Array([0x19, 0x08, 0x55]))).toEqual({ kind: 'battery', level: 85 });
    expect(parseZwiftFrame(new Uint8Array([0x15]))).toEqual({ kind: 'other', type: 0x15 });
    expect(parseZwiftFrame(new Uint8Array([0x23, 0xff]))).toEqual({ kind: 'other', type: 0x23 });
  });

  it('handshake bytes and replies', () => {
    expect([...handshake(true)]).toEqual([0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e, 0x02, 0x03]);
    expect(handshakeReply(new Uint8Array([0x52, 0x69]))).toBe('unlocked');
    expect(handshakeReply(new Uint8Array([0xff, 0x05, 0x00, 0xea, 0x05]))).toBe('locked');
  });

  it('fires only on new presses', () => {
    expect(newlyPressed(0, ZWIFT_BTN.a)).toBe(ZWIFT_BTN.a);
    expect(newlyPressed(ZWIFT_BTN.a, ZWIFT_BTN.a)).toBe(0);
    expect(newlyPressed(ZWIFT_BTN.a, ZWIFT_BTN.a | ZWIFT_BTN.b)).toBe(ZWIFT_BTN.b);
  });

  it('maps right side to shift up and left side (and B) to shift down', () => {
    expect(BUTTON_ACTIONS.shiftUpRight).toBe('shiftUp');
    expect(BUTTON_ACTIONS.shiftUpLeft).toBe('shiftDown');
    expect(BUTTON_ACTIONS.b).toBe('shiftDown');
  });
});

describe('ZwiftClickController actions', () => {
  it('debounces the same action within 100 ms but allows quick deliberate taps', () => {
    const c = new ZwiftClickController();
    const got: string[] = [];
    c.onAction((a) => got.push(a));
    c.emitAction('shiftUp', 1000);
    c.emitAction('shiftUp', 1040); // bounce / duplicate
    c.emitAction('shiftDown', 1050); // different action is not blocked
    c.emitAction('shiftUp', 1000 + DEBOUNCE_MS + 50); // a second, real tap
    expect(got).toEqual(['shiftUp', 'shiftDown', 'shiftUp']);
  });
});
