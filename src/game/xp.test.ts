import { addXp, initialLevelState, releaseBankedXp, rideXp, xpToNext } from './xp';

describe('xp curve', () => {
  it('grows with level', () => {
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(2)).toBeGreaterThan(xpToNext(1));
    expect(xpToNext(10)).toBeGreaterThan(xpToNext(9));
  });
});

describe('rideXp', () => {
  it('pays ~10 XP/min in Z1 and more in higher zones', () => {
    expect(rideXp(100, 250, 60)).toBeCloseTo(10);
    expect(rideXp(250, 250, 60)).toBeCloseTo(20); // 100% = Z4 (2.0x)
    expect(rideXp(0, 250, 60)).toBe(0);
  });
});

describe('addXp', () => {
  it('levels up across multiple levels', () => {
    const { state, levelsGained } = addXp(initialLevelState(), xpToNext(1) + xpToNext(2) + 10);
    expect(state.level).toBe(3);
    expect(state.xp).toBe(10);
    expect(levelsGained).toEqual([2, 3]);
  });

  it('has no level gates any more', () => {
    const s = { ...initialLevelState(), level: 5, xp: 0 };
    expect(addXp(s, xpToNext(5) + 10).state).toMatchObject({ level: 6, xp: 10 });
  });
});

describe('releaseBankedXp', () => {
  it('applies XP banked at an old gate (and a full bar) without double counting', () => {
    const capped = { ...initialLevelState(), level: 5, xp: xpToNext(5), bankedXp: 50, totalXp: 9999 };
    const s = releaseBankedXp(capped);
    expect(s).toMatchObject({ level: 6, xp: 50, bankedXp: 0, totalXp: 9999 });
  });

  it('leaves normal progress alone', () => {
    const s = { ...initialLevelState(), level: 3, xp: 20, totalXp: 500 };
    expect(releaseBankedXp(s)).toEqual(s);
  });
});
