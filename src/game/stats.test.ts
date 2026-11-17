import { addStats, emptyStats, pointsToNext, statGains, statLevel, statsFromRides } from './stats';

describe('fitness stats', () => {
  it('maps zone time to systems (Z1 trains nothing)', () => {
    const g = statGains([3600, 3600, 0, 0, 0, 0, 0]);
    expect(g.endurance).toBeCloseTo(0.65 ** 2 * 100 * 0.5, 1); // ~21
    expect(g.tempo).toBe(0);
    const hard = statGains([0, 0, 600, 600, 300, 60, 10]);
    expect(hard.tempo).toBeGreaterThan(0);
    expect(hard.threshold).toBeGreaterThan(0);
    expect(hard.vo2max).toBeGreaterThan(0);
    expect(hard.anaerobic).toBeGreaterThan(0);
  });

  it('a typical key session gives each system a similar number of points', () => {
    const threshold = statGains([0, 0, 0, 30 * 60, 0, 0, 0]).threshold; // 3×10 at threshold
    const vo2 = statGains([0, 0, 0, 0, 15 * 60, 0, 0]).vo2max; // 5×3 VO₂max
    const anaerobic = statGains([0, 0, 0, 0, 0, 4 * 60, 0]).anaerobic; // 8×30 s
    for (const v of [vo2, anaerobic]) {
      expect(v / threshold).toBeGreaterThan(0.6);
      expect(v / threshold).toBeLessThan(1.6);
    }
  });

  it('levels: 50 × L points to go from L to L+1', () => {
    expect(statLevel(0)).toEqual({ level: 1, into: 0, need: 50 });
    expect(statLevel(49).level).toBe(1);
    expect(statLevel(50)).toEqual({ level: 2, into: 0, need: 100 });
    expect(statLevel(50 + 100 + 30)).toEqual({ level: 3, into: 30, need: 150 });
    expect(pointsToNext(9)).toBe(450);
  });

  it('adds and seeds from rides', () => {
    const a = statsFromRides([{ zoneSec: [0, 3600, 0, 0, 0, 0, 0] }, { zoneSec: [0, 3600, 0, 0, 0, 0, 0] }]);
    expect(a.endurance).toBeCloseTo(2 * statGains([0, 3600, 0, 0, 0, 0, 0]).endurance, 1);
    expect(addStats(emptyStats(), a)).toEqual(a);
  });
});
