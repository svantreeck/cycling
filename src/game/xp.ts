import { zoneFor } from './zones';

/** XP needed to go from `level` to `level + 1`. Tuned so level ~40 takes roughly a year of regular riding. */
export function xpToNext(level: number): number {
  return Math.round(100 * Math.pow(level, 1.3));
}

/** Every 5th level is a promotion gate: you can't leave it until the promotion challenge is cleared. */
export const PROMOTION_EVERY = 5;
export const isGateLevel = (level: number) => level % PROMOTION_EVERY === 0;

/** Ride XP earned for `dtSec` seconds at `power` watts. ~10 XP/min in Z1, up to 30 XP/min in Z6+. */
export function rideXp(power: number, ftp: number, dtSec: number): number {
  if (power <= 0 || dtSec <= 0) return 0;
  return (zoneFor(power, ftp).xpMultiplier / 6) * dtSec;
}

export interface LevelState {
  level: number;
  /** progress into the current level */
  xp: number;
  /** XP earned while blocked at a promotion gate; applied once promoted */
  bankedXp: number;
  /** lifetime XP earned */
  totalXp: number;
  /** gate levels whose promotion challenge has been passed */
  promotionsCleared: number[];
}

export const initialLevelState = (): LevelState => ({
  level: 1,
  xp: 0,
  bankedXp: 0,
  totalXp: 0,
  promotionsCleared: [],
});

export const isBlockedAtGate = (s: LevelState) =>
  isGateLevel(s.level) && !s.promotionsCleared.includes(s.level);

export interface AddXpResult {
  state: LevelState;
  levelsGained: number[];
  /** true if XP hit the gate cap during this add */
  hitGate: boolean;
}

/** Add XP, advancing levels and stopping at uncleared promotion gates. */
export function addXp(s: LevelState, amount: number): AddXpResult {
  let { level, xp, bankedXp } = s;
  const levelsGained: number[] = [];
  let hitGate = false;
  let pool = amount;

  while (pool > 0) {
    const need = xpToNext(level) - xp;
    const blocked = isGateLevel(level) && !s.promotionsCleared.includes(level);
    if (pool < need) {
      xp += pool;
      pool = 0;
    } else if (blocked) {
      xp = xpToNext(level);
      bankedXp += pool - need;
      pool = 0;
      hitGate = true;
    } else {
      pool -= need;
      level += 1;
      xp = 0;
      levelsGained.push(level);
    }
  }

  return {
    state: { ...s, level, xp, bankedXp, totalXp: s.totalXp + amount },
    levelsGained,
    hitGate,
  };
}

/** Mark a gate as cleared and release any banked XP. */
export function clearPromotion(s: LevelState, gateLevel: number): AddXpResult {
  if (s.promotionsCleared.includes(gateLevel)) return { state: s, levelsGained: [], hitGate: false };
  let state: LevelState = {
    ...s,
    promotionsCleared: [...s.promotionsCleared, gateLevel],
    bankedXp: 0,
  };
  const levelsGained: number[] = [];
  // Sitting at a full bar on this gate → promote immediately.
  if (state.level === gateLevel && state.xp >= xpToNext(state.level)) {
    state = { ...state, level: state.level + 1, xp: 0 };
    levelsGained.push(state.level);
  }
  // Release banked XP (already counted in totalXp, so don't double-count).
  const res = addXp(state, s.bankedXp);
  return {
    state: { ...res.state, totalXp: s.totalXp },
    levelsGained: [...levelsGained, ...res.levelsGained],
    hitGate: res.hitGate,
  };
}
