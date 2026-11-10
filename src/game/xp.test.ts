import { addXp, clearPromotion, initialLevelState, isBlockedAtGate, rideXp, xpToNext } from './xp';

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

  it('caps at the level-5 gate and banks the overflow', () => {
    const s = { ...initialLevelState(), level: 5, xp: 0 };
    const { state, hitGate, levelsGained } = addXp(s, xpToNext(5) + 500);
    expect(hitGate).toBe(true);
    expect(levelsGained).toEqual([]);
    expect(state.level).toBe(5);
    expect(state.xp).toBe(xpToNext(5));
    expect(state.bankedXp).toBe(500);
    expect(isBlockedAtGate(state)).toBe(true);
  });

  it('passes the gate if already cleared', () => {
    const s = { ...initialLevelState(), level: 5, promotionsCleared: [5] };
    expect(addXp(s, xpToNext(5)).state.level).toBe(6);
  });
});

describe('clearPromotion', () => {
  it('promotes from a full bar and releases banked XP without double counting', () => {
    const s0 = { ...initialLevelState(), level: 5 };
    const capped = addXp(s0, xpToNext(5) + 50).state;
    const { state, levelsGained } = clearPromotion(capped, 5);
    expect(levelsGained).toEqual([6]);
    expect(state.level).toBe(6);
    expect(state.xp).toBe(50);
    expect(state.bankedXp).toBe(0);
    expect(state.totalXp).toBe(capped.totalXp);
  });

  it('clearing before the bar is full just removes the gate', () => {
    const s = { ...initialLevelState(), level: 5, xp: 10 };
    const { state, levelsGained } = clearPromotion(s, 5);
    expect(levelsGained).toEqual([]);
    expect(state.level).toBe(5);
    expect(isBlockedAtGate(state)).toBe(false);
  });
});
