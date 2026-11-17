import { actionForButton, encodeAppInfo, encodeHaptic, OBC_BUTTON, parseButtonState, PressTracker, SUPPORTED_BUTTONS } from './obc';

const dv = (bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);

describe('OpenBikeControl protocol', () => {
  it('parses button state notifications with one or several buttons', () => {
    expect(parseButtonState(dv([0x01, 0x01, 0x01]))).toEqual([{ id: 0x01, state: 1 }]);
    expect(parseButtonState(dv([0x01, 0x01, 0x01, 0x02, 0x00]))).toEqual([
      { id: 0x01, state: 1 },
      { id: 0x02, state: 0 },
    ]);
    expect(parseButtonState(dv([0x01, 0x10, 0x80]))).toEqual([{ id: 0x10, state: 0x80 }]);
  });

  it('ignores other message types and short packets', () => {
    expect(parseButtonState(dv([0x03, 0x01, 0x01]))).toEqual([]);
    expect(parseButtonState(dv([0x01]))).toEqual([]);
  });

  it('encodes App Information exactly as the spec example', () => {
    const bytes = [...encodeAppInfo('zwift', '1.52.0', [0x01, 0x02, 0x10, 0x14])];
    const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
    expect(bytes).toEqual([0x04, 0x01, 0x05, ...ascii('zwift'), 0x06, ...ascii('1.52.0'), 0x04, 0x01, 0x02, 0x10, 0x14]);
  });

  it('encodes haptics', () => {
    expect([...encodeHaptic('single')]).toEqual([0x03, 0x01, 0x00, 0x00]);
    expect([...encodeHaptic('success')]).toEqual([0x03, 0x05, 0x00, 0x00]);
  });

  it('maps standard buttons to actions, and declares every handled button', () => {
    expect(actionForButton(OBC_BUTTON.shiftUp)).toBe('shiftUp');
    expect(actionForButton(OBC_BUTTON.skipInterval)).toBe('skip');
    expect(actionForButton(0x24)).toBeUndefined(); // screenshot: not handled
    for (const id of SUPPORTED_BUTTONS) expect(actionForButton(id)).toBeDefined();
  });

  it('fires once per press, ignoring repeats and analog changes while held', () => {
    const t = new PressTracker();
    expect(t.feed([{ id: 1, state: 1 }])).toEqual([1]);
    expect(t.feed([{ id: 1, state: 1 }])).toEqual([]);
    expect(t.feed([{ id: 1, state: 0x80 }])).toEqual([]);
    expect(t.feed([{ id: 1, state: 0 }])).toEqual([]);
    expect(t.feed([{ id: 1, state: 1 }, { id: 2, state: 1 }])).toEqual([1, 2]);
  });
});
