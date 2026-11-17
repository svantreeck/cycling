import { forgetShifters, forgetTrainer, loadRemembered, rememberShifter, rememberTrainer } from './remembered';

class MemStorage {
  m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
  removeItem = (k: string) => void this.m.delete(k);
}
const mem = () => new MemStorage() as unknown as Storage;

describe('remembered devices', () => {
  it('starts empty', () => {
    expect(loadRemembered(mem())).toEqual({ shifters: [] });
  });

  it('remembers the latest trainer', () => {
    const s = mem();
    rememberTrainer({ id: 'a', name: 'KICKR CORE 1' }, s);
    rememberTrainer({ id: 'b', name: 'KICKR CORE 2' }, s);
    expect(loadRemembered(s).trainer).toEqual({ id: 'b', name: 'KICKR CORE 2' });
    forgetTrainer(s);
    expect(loadRemembered(s).trainer).toBeUndefined();
  });

  it('keeps the two most recent shifter pods, without duplicates', () => {
    const s = mem();
    rememberShifter({ id: 'r', name: 'Zwift Click' }, s);
    rememberShifter({ id: 'l', name: 'Zwift Click' }, s);
    rememberShifter({ id: 'r', name: 'Zwift Click' }, s);
    expect(loadRemembered(s).shifters.map((d) => d.id)).toEqual(['l', 'r']);
    rememberShifter({ id: 'x', name: 'Zwift Ride' }, s);
    expect(loadRemembered(s).shifters.map((d) => d.id)).toEqual(['r', 'x']);
    forgetShifters(s);
    expect(loadRemembered(s).shifters).toEqual([]);
  });

  it('survives corrupt storage', () => {
    const s = mem();
    s.setItem('cyclingquest.devices', '{nope');
    expect(loadRemembered(s)).toEqual({ shifters: [] });
  });
});
