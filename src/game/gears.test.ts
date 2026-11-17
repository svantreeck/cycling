import { clampGear, DEFAULT_GEAR, GEAR_COUNT, gradeForGear } from './gears';

describe('virtual gears', () => {
  it('the default gear is a flat road; higher gears are steeper', () => {
    expect(gradeForGear(DEFAULT_GEAR)).toBe(0);
    expect(gradeForGear(DEFAULT_GEAR + 1)).toBeGreaterThan(0);
    expect(gradeForGear(1)).toBeLessThan(0);
    expect(gradeForGear(GEAR_COUNT)).toBe(8);
  });
  it('clamps to the cassette', () => {
    expect(clampGear(0)).toBe(1);
    expect(clampGear(99)).toBe(GEAR_COUNT);
    expect(gradeForGear(99)).toBe(gradeForGear(GEAR_COUNT));
  });
});
