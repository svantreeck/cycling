import { addXp, initialLevelState, rideXp, xpToNext } from './xp';

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

  it('levels up past every 5th level freely', () => {
    const s = { ...initialLevelState(), level: 5, xp: 0 };
    expect(addXp(s, xpToNext(5) + 10).state).toMatchObject({ level: 6, xp: 10 });
  });
});
