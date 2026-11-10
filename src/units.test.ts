import { convertSpeed, speedLabel } from './units';

describe('speed units', () => {
  it('converts km/h to mph', () => {
    expect(convertSpeed(40, 'kmh')).toBe(40);
    expect(convertSpeed(1.609344, 'mph')).toBeCloseTo(1);
    expect(convertSpeed(40, 'mph')).toBeCloseTo(24.85, 2);
  });
  it('labels units', () => {
    expect(speedLabel('kmh')).toBe('km/h');
    expect(speedLabel('mph')).toBe('mph');
  });
});
