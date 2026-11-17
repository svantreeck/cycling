import type { Feel, Promotion, TrainingPlan } from '../game/coach';
import { statsFromRides, type Stats } from '../game/stats';
import { initialLevelState, releaseBankedXp, type LevelState } from '../game/xp';

export type SpeedUnit = 'kmh' | 'mph';

export const STORAGE_KEY = 'cyclingquest.profile';
/** Key used before the rename; read once so existing progress carries over. */
export const LEGACY_STORAGE_KEY = 'kickrquest.profile';
export const SCHEMA_VERSION = 1;
const MAX_RIDES = 200;

export interface RideSummary {
  id: string;
  startedAt: number;
  durationSec: number;
  kj: number;
  avgPower: number;
  maxPower: number;
  /** seconds per zone, index 0 = Z1 */
  zoneSec: number[];
  xpEarned: number;
  challenges: { id: string; passed: boolean; xp: number; feel?: Feel }[];
  /** training stress score; missing on rides saved before it was tracked */
  tss?: number;
  /** metres (trainer-reported speed, or estimated from power); missing on older rides */
  distanceM?: number;
}

export interface ChallengeRecord {
  count: number;
  attempts: number;
  lastCompletedAt?: number;
  /** best avg power (bestAvg rules) */
  best?: number;
}

export interface Profile {
  schemaVersion: number;
  name: string;
  ftp: number;
  ftpHistory: { at: number; ftp: number }[];
  levels: LevelState;
  completed: Record<string, ChallengeRecord>;
  rides: RideSummary[];
  cosmetics: { kitColor: string };
  settings: { onboarded: boolean; speedUnit: SpeedUnit };
  /** local date (YYYY-MM-DD) the daily bounty was last claimed */
  bountyClaimedOn?: string;
  /** the rider's goal and weekly availability; the coach uses defaults when unset */
  plan?: TrainingPlan;
  /** lifetime fitness-stat points per system (never trimmed, unlike `rides`) */
  stats: Stats;
  /** training blocks completed with a passed FTP retest; the count is the rider's rank */
  promotions: Promotion[];
}

export const defaultProfile = (): Profile => ({
  schemaVersion: SCHEMA_VERSION,
  name: 'Rider',
  ftp: 200,
  ftpHistory: [],
  levels: initialLevelState(),
  completed: {},
  rides: [],
  stats: statsFromRides([]),
  promotions: [],
  cosmetics: { kitColor: '#95a5a6' },
  settings: { onboarded: false, speedUnit: 'kmh' },
});

/** Upgrade older saved shapes. Add a case per schema bump. */
export function migrate(raw: unknown): Profile {
  if (!raw || typeof raw !== 'object') return defaultProfile();
  const p = raw as Partial<Profile>;
  const base = defaultProfile();
  // v1 is the first version: fill any missing fields with defaults.
  return {
    ...base,
    ...p,
    // Level gates were removed: release any XP banked while stuck at one.
    levels: releaseBankedXp({ ...base.levels, ...(p.levels ?? {}) }),
    cosmetics: { ...base.cosmetics, ...(p.cosmetics ?? {}) },
    settings: { ...base.settings, ...(p.settings ?? {}) },
    // Stats arrived after rides were already being saved: seed them from the saved rides.
    stats: { ...statsFromRides(p.rides ?? []), ...(p.stats ?? {}) },
    schemaVersion: SCHEMA_VERSION,
  };
}

export function loadProfile(storage: Storage | undefined = globalThis.localStorage): Profile {
  try {
    const s = storage?.getItem(STORAGE_KEY) ?? storage?.getItem(LEGACY_STORAGE_KEY);
    return s ? migrate(JSON.parse(s)) : defaultProfile();
  } catch (e) {
    console.warn('Failed to load profile, starting fresh', e);
    return defaultProfile();
  }
}

export function saveProfile(p: Profile, storage: Storage | undefined = globalThis.localStorage) {
  const trimmed = { ...p, rides: p.rides.slice(-MAX_RIDES) };
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('Failed to save profile', e);
  }
}

export function exportProfile(p: Profile): string {
  return JSON.stringify(p, null, 2);
}

export function importProfile(json: string): Profile {
  const parsed = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed == null || !('levels' in parsed)) {
    throw new Error("That file doesn't look like a Cycling Quest profile.");
  }
  return migrate(parsed);
}
