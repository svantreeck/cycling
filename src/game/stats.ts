import type { FitnessSystem } from './challenges';

/**
 * RPG-style fitness stats. Every ride adds points to the systems it trained, based on time in each power zone:
 * Z2 → Endurance, Z3 → Tempo, Z4 → Threshold, Z5 → VO₂max, Z6–7 → Anaerobic. Points are training stress
 * (TSS) scaled per system so that typical training levels each system at a similar pace. Stats never drop.
 */

export const SYSTEMS: FitnessSystem[] = ['endurance', 'tempo', 'threshold', 'vo2max', 'anaerobic'];

export const SYSTEM_INFO: Record<FitnessSystem, { name: string; icon: string; color: string; blurb: string }> = {
  endurance: { name: 'Endurance', icon: '🫁', color: '#3498db', blurb: 'Aerobic base from Zone 2 riding.' },
  tempo: { name: 'Tempo', icon: '🛤️', color: '#2ecc71', blurb: 'Stamina for steady, moderately hard efforts.' },
  threshold: { name: 'Threshold', icon: '⛰️', color: '#f1c40f', blurb: 'The power you can hold for about an hour.' },
  vo2max: { name: 'VO₂max', icon: '❤️‍🔥', color: '#e67e22', blurb: 'Your aerobic ceiling, for 3–8 minute efforts.' },
  anaerobic: { name: 'Anaerobic', icon: '⚡', color: '#e74c3c', blurb: 'Punch and sprint power.' },
};

export type Stats = Record<FitnessSystem, number>;

export const emptyStats = (): Stats => ({ endurance: 0, tempo: 0, threshold: 0, vo2max: 0, anaerobic: 0 });

/** Representative intensity (fraction of FTP) per zone, Z1…Z7. */
const ZONE_IF = [0.45, 0.65, 0.83, 0.98, 1.13, 1.35, 2.0];
/** Which system each zone trains (Z1 trains none). */
const ZONE_SYSTEM: (FitnessSystem | null)[] = [null, 'endurance', 'tempo', 'threshold', 'vo2max', 'anaerobic', 'anaerobic'];
/** Per-system multiplier so each stat grows at a similar pace with typical training. */
const SCALE: Stats = { endurance: 0.5, tempo: 1.5, threshold: 1, vo2max: 1.5, anaerobic: 4 };

/** Stat points earned from one ride's zone time (seconds per zone, index 0 = Z1). */
export function statGains(zoneSec: number[]): Stats {
  const out = emptyStats();
  zoneSec.forEach((sec, i) => {
    const sys = ZONE_SYSTEM[i];
    if (sys && sec > 0) out[sys] += ((sec * ZONE_IF[i] ** 2) / 3600) * 100 * SCALE[sys];
  });
  for (const s of SYSTEMS) out[s] = Math.round(out[s] * 10) / 10;
  return out;
}

export const addStats = (a: Stats, b: Stats): Stats => {
  const out = emptyStats();
  for (const s of SYSTEMS) out[s] = Math.round(((a[s] ?? 0) + (b[s] ?? 0)) * 10) / 10;
  return out;
};

export const statsFromRides = (rides: { zoneSec: number[] }[]): Stats => rides.reduce((acc, r) => addStats(acc, statGains(r.zoneSec)), emptyStats());

/** Points to go from level L to L+1. Level 10 takes roughly six months of steady training. */
export const pointsToNext = (level: number) => 50 * level;

export interface StatLevel {
  level: number;
  /** points into the current level */
  into: number;
  /** points needed for the next level */
  need: number;
}

export function statLevel(points: number): StatLevel {
  let level = 1;
  let rest = Math.max(0, points);
  while (rest >= pointsToNext(level)) {
    rest -= pointsToNext(level);
    level++;
  }
  return { level, into: rest, need: pointsToNext(level) };
}
