import { clampGear, DEFAULT_GEAR, GEAR_COUNT, gearRatio, gradeForGear, MAX_GRADE, MIN_GRADE, virtualSpeedKph } from './gears';

describe('virtual gears', () => {
  it('gear 12 is the 1:1, flat-road gear', () => {
    expect(DEFAULT_GEAR).toBe(12);
    expect(gearRatio(DEFAULT_GEAR)).toBe(1);
    expect(gradeForGear(DEFAULT_GEAR, 30)).toBe(0);
    expect(virtualSpeedKph(30, DEFAULT_GEAR)).toBe(30);
  });

  it('each shift up covers ~7.5% more road per pedal stroke', () => {
    expect(virtualSpeedKph(30, DEFAULT_GEAR + 1)).toBeCloseTo(32.25, 2);
    expect(virtualSpeedKph(30, DEFAULT_GEAR - 1)).toBeCloseTo(27.91, 2);
  });

  it('a shift is a clear step: higher gears need a steeper grade, more so at speed', () => {
    const at30 = gradeForGear(DEFAULT_GEAR + 1, 30);
    expect(at30).toBeGreaterThan(0.8); // vs the old flat 0.5% per gear
    expect(gradeForGear(DEFAULT_GEAR + 2, 30)).toBeGreaterThan(at30);
    expect(gradeForGear(DEFAULT_GEAR + 1, 40)).toBeGreaterThan(at30); // spinning out a gear gets harder
    expect(gradeForGear(DEFAULT_GEAR - 1, 30)).toBeLessThan(0);
  });

  it('stays within what the trainer accepts', () => {
    expect(gradeForGear(GEAR_COUNT, 45)).toBe(MAX_GRADE);
    expect(gradeForGear(1, 60)).toBe(MIN_GRADE);
    expect(gradeForGear(DEFAULT_GEAR + 3, 0)).toBeGreaterThan(0); // standing start still feels the gear
  });

  it('clamps to the cassette', () => {
    expect(clampGear(0)).toBe(1);
    expect(clampGear(99)).toBe(GEAR_COUNT);
  });
});
