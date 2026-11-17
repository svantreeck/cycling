import { buildTcx } from '../strava/tcx';
import { loadTrack, saveTrack, TrackRecorder } from '../strava/track';
import { parseHeartRate } from './heartRate';

const dv = (bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);

describe('parseHeartRate', () => {
  it('reads an 8-bit rate', () => {
    expect(parseHeartRate(dv([0x00, 72]))).toBe(72);
  });

  it('reads a 16-bit rate (flag bit 0) and ignores trailing RR intervals', () => {
    expect(parseHeartRate(dv([0x11, 0xa0, 0x00, 0x10, 0x03]))).toBe(160);
  });

  it('treats 0 (strap not on skin) and short packets as no reading', () => {
    expect(parseHeartRate(dv([0x00, 0]))).toBeNull();
    expect(parseHeartRate(dv([0x01, 0x50]))).toBeNull();
    expect(parseHeartRate(dv([0x00]))).toBeNull();
  });
});

class MemStorage {
  m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
  removeItem = (k: string) => void this.m.delete(k);
}

describe('heart rate in tracks and TCX', () => {
  it('records, stores and exports heart rate', () => {
    const r = new TrackRecorder();
    r.add({ t: 0, power: 200, cadence: 90, speedKph: 36 }, 0, false);
    r.add({ t: 1000, power: 200, cadence: 90, speedKph: 36 }, 1000, true, 140);
    r.add({ t: 2000, power: 200, cadence: 90, speedKph: 36 }, 1000, true, null); // strap dropped
    r.add({ t: 3000, power: 200, cadence: 90, speedKph: 36 }, 1000, true, 150);
    expect(r.points.map((p) => p.hr)).toEqual([140, undefined, 150]);

    const s = new MemStorage() as unknown as Storage;
    saveTrack({ rideId: 'x', startedAt: Date.UTC(2026, 10, 17), points: r.points }, s);
    const track = loadTrack('x', s)!;
    expect(track.points.map((p) => p.hr)).toEqual([140, undefined, 150]);

    const xml = buildTcx(track, { kj: 1 });
    expect(xml).toContain('<DistanceMeters>10.0</DistanceMeters><HeartRateBpm><Value>140</Value></HeartRateBpm><Cadence>');
    expect(xml).toContain('<AverageHeartRateBpm><Value>145</Value></AverageHeartRateBpm>');
    expect(xml).toContain('<MaximumHeartRateBpm><Value>150</Value></MaximumHeartRateBpm>');
    expect(xml.match(/<HeartRateBpm>/g)).toHaveLength(2);
  });

  it('leaves heart rate out of the TCX when there was none', () => {
    const xml = buildTcx({ rideId: 'y', startedAt: 0, points: [{ sec: 0, power: 100, cadence: 80, speedKph: 30, distanceM: 0 }] }, { kj: 1 });
    expect(xml).not.toContain('HeartRate');
  });
});
