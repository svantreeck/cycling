import { buildTcx } from './tcx';
import { hasTrack, loadTrack, MAX_TRACKS, saveTrack, TrackRecorder, type Track } from './track';

class MemStorage {
  m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
  removeItem = (k: string) => void this.m.delete(k);
}
const mem = () => new MemStorage() as unknown as Storage;

describe('TrackRecorder', () => {
  it('records one point per second and integrates distance', () => {
    const r = new TrackRecorder();
    r.add({ t: 0, power: 200, cadence: 90, speedKph: 36 }, 0, false); // first sample sets the clock
    for (let ms = 250; ms <= 3000; ms += 250) r.add({ t: ms, power: 200, cadence: 90, speedKph: 36 }, 250, true);
    expect(r.points.map((p) => p.sec)).toEqual([0, 1, 2, 3]);
    expect(r.distance).toBeCloseTo(30); // 10 m/s for 3 s
    expect(r.points[3].distanceM).toBeCloseTo(30);
  });

  it('leaves a gap while paused', () => {
    const r = new TrackRecorder();
    r.add({ t: 0, power: 0, cadence: 0, speedKph: 0 }, 0, false);
    r.add({ t: 1000, power: 150, cadence: 80, speedKph: 30 }, 1000, true);
    r.add({ t: 2000, power: 0, cadence: 0, speedKph: 0 }, 1000, false);
    r.add({ t: 3000, power: 150, cadence: 80, speedKph: 30 }, 1000, true);
    expect(r.points.map((p) => p.sec)).toEqual([1, 3]);
  });

  it('estimates speed from power when the trainer sends none', () => {
    const r = new TrackRecorder();
    r.add({ t: 0, power: 250, cadence: 90, speedKph: 0 }, 0, false);
    r.add({ t: 1000, power: 250, cadence: 90, speedKph: 0 }, 1000, true);
    expect(r.points[0].speedKph).toBeGreaterThan(30);
    expect(r.distance).toBeGreaterThan(8);
  });
});

describe('track storage', () => {
  const track = (id: string): Track => ({
    rideId: id,
    startedAt: 1_700_000_000_000,
    points: [{ sec: 0, power: 100, cadence: 85, speedKph: 25.5, distanceM: 7.1 }],
  });

  it('round-trips a track', () => {
    const s = mem();
    saveTrack(track('a'), s);
    expect(loadTrack('a', s)).toEqual(track('a'));
    expect(hasTrack('b', s)).toBe(false);
  });

  it('keeps only the most recent tracks', () => {
    const s = mem();
    for (let i = 0; i < MAX_TRACKS + 2; i++) saveTrack(track(String(i)), s);
    expect(hasTrack('0', s)).toBe(false);
    expect(hasTrack('1', s)).toBe(false);
    expect(hasTrack(String(MAX_TRACKS + 1), s)).toBe(true);
  });
});

describe('buildTcx', () => {
  it('writes a lap with time, distance, cadence, speed and watts per trackpoint', () => {
    const xml = buildTcx(
      {
        rideId: 'x',
        startedAt: Date.UTC(2026, 10, 17, 18, 0, 0),
        points: [
          { sec: 0, power: 200, cadence: 90, speedKph: 36, distanceM: 0 },
          { sec: 1, power: 210, cadence: 300, speedKph: 36, distanceM: 10 },
        ],
      },
      { kj: 42, notes: 'Sweet spot & more' },
    );
    expect(xml).toContain('<Activity Sport="Biking">');
    expect(xml).toContain('<Id>2026-11-17T18:00:00Z</Id>');
    expect(xml).toContain('<Time>2026-11-17T18:00:01Z</Time><DistanceMeters>10.0</DistanceMeters><Cadence>254</Cadence>');
    expect(xml).toContain('<ns3:Speed>10.00</ns3:Speed><ns3:Watts>210</ns3:Watts>');
    expect(xml).toContain('<TotalTimeSeconds>1</TotalTimeSeconds>');
    expect(xml).toContain('<Calories>42</Calories>');
    expect(xml).toContain('<Notes>Sweet spot &amp; more</Notes>');
  });
});
