/**
 * Second-by-second ride track (power, cadence, speed, distance), kept so a finished ride can be exported or
 * uploaded to Strava. Tracks live in their own storage key, outside the profile, and only the most recent few
 * are kept: they are much bigger than ride summaries.
 */

export interface TrackPoint {
  /** seconds since the ride's first sample */
  sec: number;
  power: number;
  cadence: number;
  speedKph: number;
  /** cumulative metres */
  distanceM: number;
}

export interface Track {
  /** RideSummary.id */
  rideId: string;
  startedAt: number;
  points: TrackPoint[];
}

export const TRACKS_KEY = 'cyclingquest.tracks';
export const MAX_TRACKS = 5;

/**
 * Trainers that report only power (Cycling Power Service) send no speed. Estimate a flat-road speed from power so
 * the upload still has distance: P ≈ 0.25·v³ (v in m/s) is close to a rider on the hoods on flat ground.
 */
export const speedFromPower = (watts: number) => (watts > 0 ? Math.cbrt(watts / 0.25) * 3.6 : 0);

/** Builds a track from trainer samples: one point per second while the rider is moving. */
export class TrackRecorder {
  points: TrackPoint[] = [];
  private t0: number | null = null;
  private lastSec = -1;
  private distanceM = 0;

  /** `moving` is false while the ride is auto-paused, so pauses show as gaps (Strava then excludes them). */
  add(sample: { t: number; power: number; cadence: number; speedKph: number }, dtMs: number, moving: boolean) {
    if (this.t0 == null) this.t0 = sample.t;
    if (!moving) return;
    const speedKph = sample.speedKph > 0 ? sample.speedKph : speedFromPower(sample.power);
    this.distanceM += (speedKph / 3.6) * (dtMs / 1000);
    const sec = Math.floor((sample.t - this.t0) / 1000);
    if (sec === this.lastSec) return;
    this.lastSec = sec;
    this.points.push({
      sec,
      power: Math.round(sample.power),
      cadence: Math.round(sample.cadence),
      speedKph: Math.round(speedKph * 10) / 10,
      distanceM: Math.round(this.distanceM * 10) / 10,
    });
  }

  get distance() {
    return this.distanceM;
  }
}

// Stored compactly as arrays: [sec, power, cadence, speedKph, distanceM].
type StoredTrack = { rideId: string; startedAt: number; p: number[][] };

function readAll(storage: Storage | undefined): StoredTrack[] {
  try {
    const raw = storage?.getItem(TRACKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTrack(track: Track, storage: Storage | undefined = globalThis.localStorage) {
  const stored: StoredTrack = {
    rideId: track.rideId,
    startedAt: track.startedAt,
    p: track.points.map((q) => [q.sec, q.power, q.cadence, q.speedKph, q.distanceM]),
  };
  let all = [...readAll(storage).filter((t) => t.rideId !== track.rideId), stored].slice(-MAX_TRACKS);
  // If storage is full, drop the oldest tracks until it fits.
  while (all.length) {
    try {
      storage?.setItem(TRACKS_KEY, JSON.stringify(all));
      return;
    } catch {
      all = all.slice(1);
    }
  }
}

export function loadTrack(rideId: string, storage: Storage | undefined = globalThis.localStorage): Track | null {
  const t = readAll(storage).find((x) => x.rideId === rideId);
  if (!t) return null;
  return {
    rideId: t.rideId,
    startedAt: t.startedAt,
    points: t.p.map(([sec, power, cadence, speedKph, distanceM]) => ({ sec, power, cadence, speedKph, distanceM })),
  };
}

export const hasTrack = (rideId: string, storage: Storage | undefined = globalThis.localStorage) =>
  readAll(storage).some((t) => t.rideId === rideId);
