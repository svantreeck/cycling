import type { TrackPoint } from '../strava/track';
import { ftpAt, median, rideMetrics } from './rideMetrics';

const FTP = 200;

/** A track of `sec` seconds starting at `from`, with per-second power, cadence and heart rate. */
function track(sec: number, f: (s: number) => { power: number; cadence: number; hr?: number }, from = 0): TrackPoint[] {
  return Array.from({ length: sec }, (_, i) => ({ sec: from + i, speedKph: 30, distanceM: 0, ...f(from + i) }));
}

describe('ride metrics', () => {
  it('medians', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it('finds easy and hard cadence', () => {
    const pts = [
      ...track(1200, () => ({ power: 130, cadence: 88 })),
      ...track(600, () => ({ power: 200, cadence: 76 }), 1200),
    ];
    const m = rideMetrics(pts, FTP);
    expect(m.cadence?.easy).toBe(88);
    expect(m.cadence?.hard).toBe(76);
  });

  it('compares early and late cadence on rides with 30+ working minutes', () => {
    const pts = track(3600, (s) => ({ power: 140, cadence: s < 1800 ? 90 : 82 }));
    const m = rideMetrics(pts, FTP);
    expect(m.cadence?.early).toBe(90);
    expect(m.cadence?.late).toBe(82);
    expect(rideMetrics(track(1200, () => ({ power: 140, cadence: 90 })), FTP).cadence?.early).toBeUndefined();
  });

  it('measures heart rate at Zone 2 power, skipping the first 10 minutes', () => {
    const pts = track(1800, (s) => ({ power: 140, cadence: 88, hr: s < 600 ? 100 : 125 }));
    const m = rideMetrics(pts, FTP);
    expect(m.aerobic).toEqual({ sec: 1200, watts: 140, hr: 125 });
  });

  it('ignores hard efforts and rides without heart rate', () => {
    expect(rideMetrics(track(1800, () => ({ power: 200, cadence: 85, hr: 160 })), FTP).aerobic).toBeUndefined();
    expect(rideMetrics(track(1800, () => ({ power: 140, cadence: 85 })), FTP).aerobic).toBeUndefined();
  });

  it('measures heart-rate drift on long Zone 2 rides', () => {
    // 140 W throughout; HR 120 in the first half of the steady part, 130 in the second
    const pts = track(3600, (s) => ({ power: 140, cadence: 88, hr: s < 2100 ? 120 : 130 }));
    const drift = rideMetrics(pts, FTP).aerobic?.drift;
    expect(drift).toBeCloseTo(((140 / 120 - 140 / 130) / (140 / 120)) * 100, 0);
  });

  it('looks up the FTP in effect at a time', () => {
    const h = [
      { at: 100, ftp: 200 },
      { at: 200, ftp: 220 },
    ];
    expect(ftpAt(h, 150, 999)).toBe(200);
    expect(ftpAt(h, 250, 999)).toBe(220);
    expect(ftpAt(h, 50, 999)).toBe(200);
    expect(ftpAt([], 50, 999)).toBe(999);
  });
});
