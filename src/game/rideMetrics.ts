import type { TrackPoint } from '../strava/track';

/**
 * A few numbers per ride, worked out from its second-by-second track when it ends, that the coach compares across
 * rides to spot trends. Kept small: the track itself is only stored for the last few rides.
 */
export interface RideMetrics {
  /** median cadence (rpm) while pedalling */
  cadence?: {
    /** at Zone 1–2 power: the rider's natural cadence */
    easy?: number;
    /** at Zone 4 power or above */
    hard?: number;
    /** first and last third of the ride's working time (Zone 2 power or above), for rides with 30+ minutes of it */
    early?: number;
    late?: number;
  };
  /** steady Zone 2 riding with heart rate, after the first 10 minutes */
  aerobic?: {
    sec: number;
    watts: number;
    hr: number;
    /** % drop in watts-per-beat from the first half to the second, for 40+ minutes of it; > 5 = HR drifting up */
    drift?: number;
  };
}

const Z2_MIN = 0.55;
const Z2_MAX = 0.76;
const Z4_MIN = 0.91;
/** heart rate takes a while to settle, so the first minutes of a ride don't count towards `aerobic` */
const HR_SETTLE_SEC = 600;
const SMOOTH_SEC = 30;

export const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function rideMetrics(points: TrackPoint[], ftp: number): RideMetrics {
  const out: RideMetrics = {};
  const pedalling = points.filter((p) => p.power > 0 && p.cadence >= 20);

  // ---- cadence
  const easy = pedalling.filter((p) => p.power < Z2_MAX * ftp).map((p) => p.cadence);
  const hard = pedalling.filter((p) => p.power >= Z4_MIN * ftp).map((p) => p.cadence);
  const working = pedalling.filter((p) => p.power >= Z2_MIN * ftp).map((p) => p.cadence);
  const cadence: NonNullable<RideMetrics['cadence']> = {};
  if (easy.length >= 300) cadence.easy = Math.round(median(easy));
  if (hard.length >= 120) cadence.hard = Math.round(median(hard));
  if (working.length >= 1800) {
    const third = Math.floor(working.length / 3);
    cadence.early = Math.round(median(working.slice(0, third)));
    cadence.late = Math.round(median(working.slice(-third)));
  }
  if (Object.keys(cadence).length) out.cadence = cadence;

  // ---- aerobic: points whose 30-second average power is in Zone 2, with heart rate
  const steady: TrackPoint[] = [];
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += points[i].power;
    if (i >= SMOOTH_SEC) sum -= points[i - SMOOTH_SEC].power;
    const p = points[i];
    if (i < SMOOTH_SEC - 1 || p.sec < HR_SETTLE_SEC || !p.hr || p.power <= 0) continue;
    const avg = sum / SMOOTH_SEC;
    if (avg >= Z2_MIN * ftp && avg < Z2_MAX * ftp) steady.push(p);
  }
  if (steady.length >= 600) {
    const watts = mean(steady.map((p) => p.power));
    const hr = mean(steady.map((p) => p.hr!));
    out.aerobic = { sec: steady.length, watts: Math.round(watts), hr: Math.round(hr) };
    if (steady.length >= 2400) {
      const half = steady.length >> 1;
      const ef = (ps: TrackPoint[]) => mean(ps.map((p) => p.power)) / mean(ps.map((p) => p.hr!));
      const first = ef(steady.slice(0, half));
      const second = ef(steady.slice(half));
      out.aerobic.drift = Math.round(((first - second) / first) * 1000) / 10;
    }
  }
  return out;
}

/** FTP in effect at time `at`, from the FTP history (falls back to `fallback` before the first entry). */
export function ftpAt(history: { at: number; ftp: number }[], at: number, fallback: number): number {
  let ftp = fallback;
  let found = false;
  for (const h of history) {
    if (h.at <= at) {
      ftp = h.ftp;
      found = true;
    }
  }
  return found ? ftp : (history[0]?.ftp ?? fallback);
}
