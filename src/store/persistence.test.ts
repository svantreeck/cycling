import { LEGACY_STORAGE_KEY, STORAGE_KEY, defaultProfile, importProfile, loadProfile, saveProfile } from './persistence';

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('persistence', () => {
  it('round-trips a profile', () => {
    const st = new MemStorage() as unknown as Storage;
    const p = { ...defaultProfile(), ftp: 275 };
    p.levels.level = 7;
    saveProfile(p, st);
    expect(loadProfile(st)).toEqual(p);
  });

  it('fills missing fields from defaults and survives garbage', () => {
    const st = new MemStorage() as unknown as Storage;
    st.setItem(STORAGE_KEY, JSON.stringify({ ftp: 300, levels: { level: 3 } }));
    const p = loadProfile(st);
    expect(p.ftp).toBe(300);
    expect(p.levels.level).toBe(3);
    expect(p.levels.promotionsCleared).toEqual([]);
    st.setItem(STORAGE_KEY, '{not json');
    expect(loadProfile(st)).toEqual(defaultProfile());
  });

  it('loads progress saved under the pre-rename key', () => {
    const st = new MemStorage() as unknown as Storage;
    st.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ ftp: 260, levels: { level: 4 } }));
    expect(loadProfile(st).ftp).toBe(260);
    // a save under the new key takes precedence from then on
    saveProfile({ ...defaultProfile(), ftp: 280 }, st);
    expect(loadProfile(st).ftp).toBe(280);
  });

  it('seeds fitness stats from saved rides for profiles saved before stats existed', () => {
    const old = { ...defaultProfile(), rides: [{ zoneSec: [0, 3600, 0, 0, 0, 0, 0] }] } as Record<string, unknown>;
    delete old.stats;
    const p = importProfile(JSON.stringify(old));
    expect(p.stats.endurance).toBeGreaterThan(0);
    // existing stats are kept as-is
    const kept = importProfile(JSON.stringify({ ...defaultProfile(), stats: { ...defaultProfile().stats, tempo: 99 } }));
    expect(kept.stats.tempo).toBe(99);
  });

  it('rejects non-profile imports', () => {
    expect(() => importProfile('{"hello":1}')).toThrow();
  });
});
