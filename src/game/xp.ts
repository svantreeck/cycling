import { zoneFor } from './zones';

/** XP needed to go from `level` to `level + 1`. Tuned so level ~40 takes roughly a year of regular riding. */
export function xpToNext(level: number): number {
  return Math.round(100 * Math.pow(level, 1.3));
}

/** Ride XP earned for `dtSec` seconds at `power` watts. ~10 XP/min in Z1, up to 30 XP/min in Z6+. */
export function rideXp(power: number, ftp: number, dtSec: number): number {
  if (power <= 0 || dtSec <= 0) return 0;
  return (zoneFor(power, ftp).xpMultiplier / 6) * dtSec;
}

export interface LevelState {
  level: number;
  /** progress into the current level */
  xp: number;
  /** legacy: XP banked at the old every-5-levels promotion gates; released by `releaseBankedXp` */
  bankedXp: number;
  /** lifetime XP earned */
  totalXp: number;
  /** legacy: gate levels whose old promotion trial was passed (kept for history) */
  promotionsCleared: number[];
}

export const initialLevelState = (): LevelState => ({
  level: 1,
  xp: 0,
  bankedXp: 0,
  totalXp: 0,
  promotionsCleared: [],
});

export interface AddXpResult {
  state: LevelState;
  levelsGained: number[];
}

/** Add XP, advancing as many levels as it covers. */
export function addXp(s: LevelState, amount: number): AddXpResult {
  let { level, xp } = s;
  const levelsGained: number[] = [];
  xp += Math.max(0, amount);
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    levelsGained.push(level);
  }
  return { state: { ...s, level, xp, totalXp: s.totalXp + Math.max(0, amount) }, levelsGained };
}

/**
 * Level gates were replaced by training-block promotions. Riders saved while stuck at a gate get their banked XP
 * (and any full bar) applied. Banked XP is already in totalXp, so it isn't counted twice.
 */
export function releaseBankedXp(s: LevelState): LevelState {
  const res = addXp({ ...s, bankedXp: 0 }, s.bankedXp ?? 0);
  return { ...res.state, totalXp: s.totalXp };
}
