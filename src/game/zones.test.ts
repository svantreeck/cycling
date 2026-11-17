import { DEFAULT_MAX_HR, estimateMaxHr, hrZoneFor, ZONES } from './zones';

describe('heart-rate zones', () => {
  it('splits by % of max HR', () => {
    expect(hrZoneFor(100, 200).id).toBe(1);
    expect(hrZoneFor(120, 200).id).toBe(2);
    expect(hrZoneFor(150, 200).id).toBe(3);
    expect(hrZoneFor(170, 200).id).toBe(4);
    expect(hrZoneFor(195, 200).id).toBe(5);
  });

  it('uses the power-zone colours, so easy riding is not red', () => {
    expect(hrZoneFor(120, 200).color).toBe(ZONES[1].color);
    expect(hrZoneFor(195, 200).color).toBe(ZONES[4].color);
  });

  it('estimates max HR from rides, never below the default', () => {
    expect(estimateMaxHr([])).toBe(DEFAULT_MAX_HR);
    expect(estimateMaxHr([{ maxHr: 160 }, {}])).toBe(DEFAULT_MAX_HR);
    expect(estimateMaxHr([{ maxHr: 160 }, { maxHr: 193 }])).toBe(193);
  });
});
