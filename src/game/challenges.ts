import { PROMOTION_EVERY } from './xp';

export type StepMode = 'erg' | 'free';
export type StepKind = 'warmup' | 'work' | 'rest' | 'effort' | 'cooldown';

export interface Step {
  label: string;
  kind: StepKind;
  durationSec: number;
  mode: StepMode;
  /** ERG target as % of FTP (erg steps), or a guide target for free steps */
  targetPctFtp?: number;
}

export type SuccessRule =
  /** Finish every work/rest step without cracking (ERG intervals). */
  | { kind: 'completeAll' }
  /** Average ≥ pctFtp over any `windowSec` window during effort steps. Covers sprints, best-minute and holds. */
  | { kind: 'bestAvg'; windowSec: number; pctFtp: number }
  /** Cadence ≥ rpm continuously for durationSec during effort steps. */
  | { kind: 'cadence'; rpm: number; durationSec: number }
  /** Ramp test: ride until you crack; FTP = 75% of best 1-minute power. */
  | { kind: 'ramp' };

export interface Challenge {
  id: string;
  name: string;
  description: string;
  tier: number;
  minLevel: number;
  xpReward: number;
  /** gate level this challenge clears */
  promotionFor?: number;
  repeatable: boolean;
  steps: Step[];
  success: SuccessRule;
}

// ---- step builders ------------------------------------------------------

const warmup = (min = 5): Step[] => [
  { label: 'Warm up', kind: 'warmup', durationSec: (min - 1) * 60, mode: 'erg', targetPctFtp: 55 },
  { label: 'Openers', kind: 'warmup', durationSec: 60, mode: 'erg', targetPctFtp: 75 },
];
const cooldown = (min = 3): Step[] => [
  { label: 'Cool down', kind: 'cooldown', durationSec: min * 60, mode: 'erg', targetPctFtp: 45 },
];

function intervals(reps: number, workSec: number, workPct: number, restSec: number, restPct = 50): Step[] {
  const out: Step[] = [];
  for (let i = 0; i < reps; i++) {
    out.push({ label: `Rep ${i + 1}/${reps}`, kind: 'work', durationSec: workSec, mode: 'erg', targetPctFtp: workPct });
    if (i < reps - 1 || restSec > 0)
      out.push({ label: 'Recover', kind: 'rest', durationSec: restSec, mode: 'erg', targetPctFtp: restPct });
  }
  return out;
}

const effort = (label: string, durationSec: number, guidePct?: number): Step[] => [
  { label, kind: 'effort', durationSec, mode: 'free', targetPctFtp: guidePct },
];

const erg = (
  id: string,
  name: string,
  description: string,
  tier: number,
  minLevel: number,
  xpReward: number,
  main: Step[],
): Challenge => ({
  id,
  name,
  description,
  tier,
  minLevel,
  xpReward,
  repeatable: true,
  steps: [...warmup(), ...main, ...cooldown()],
  success: { kind: 'completeAll' },
});

const free = (
  id: string,
  name: string,
  description: string,
  tier: number,
  minLevel: number,
  xpReward: number,
  windowSec: number,
  success: SuccessRule,
  guidePct?: number,
): Challenge => ({
  id,
  name,
  description,
  tier,
  minLevel,
  xpReward,
  repeatable: true,
  steps: [...warmup(), ...effort('GO! Max effort', windowSec, guidePct), ...cooldown()],
  success,
});

// ---- ramp test ----------------------------------------------------------

export const RAMP_START_PCT = 50;
export const RAMP_STEP_PCT = 6;
export const RAMP_MAX_STEPS = 30;

export const RAMP_TEST: Challenge = {
  id: 'ramp-test',
  name: 'Ramp Test',
  description:
    'Resistance rises every minute until you can no longer hold it. Your FTP is set to 75% of your best 1-minute power. Raising your FTP earns bonus XP.',
  tier: 1,
  minLevel: 1,
  xpReward: 150,
  repeatable: true,
  steps: [
    { label: 'Easy spin', kind: 'warmup', durationSec: 180, mode: 'erg', targetPctFtp: 45 },
    ...Array.from({ length: RAMP_MAX_STEPS }, (_, i): Step => ({
      label: `Ramp step ${i + 1}`,
      kind: 'work',
      durationSec: 60,
      mode: 'erg',
      targetPctFtp: RAMP_START_PCT + RAMP_STEP_PCT * i,
    })),
    ...cooldown(),
  ],
  success: { kind: 'ramp' },
};

// ---- catalog ------------------------------------------------------------

export const CHALLENGES: Challenge[] = [
  RAMP_TEST,
  // Tier 1 — levels 1–4
  free('spin-up', 'Spin Up', 'Hold 100+ rpm for one minute. Use an easy gear.', 1, 1, 60, 120, {
    kind: 'cadence',
    rpm: 100,
    durationSec: 60,
  }),
  free('first-sprint', 'First Sprint', 'Average 150% of FTP for 10 seconds. Shift up and go.', 1, 1, 80, 60, {
    kind: 'bestAvg',
    windowSec: 10,
    pctFtp: 150,
  }, 150),
  erg('3030-starter', '30/30 Starter', '6 × 30 s at 120% FTP with 30 s easy between. The trainer sets the watts, so keep pedalling.', 1, 2, 120,
    intervals(6, 30, 120, 30)),
  // Tier 2 — levels 5–9
  erg('5x1', 'Five Alive', '5 × 1 min at 130% FTP with 1 min recovery.', 2, 5, 200, intervals(5, 60, 130, 60)),
  free('sprint-200', 'Sprint Double', 'Average 200% of FTP for 10 seconds.', 2, 6, 180, 60, {
    kind: 'bestAvg',
    windowSec: 10,
    pctFtp: 200,
  }, 200),
  free('cadence-110', 'Washing Machine', 'Hold 110+ rpm for two minutes straight.', 2, 6, 150, 180, {
    kind: 'cadence',
    rpm: 110,
    durationSec: 120,
  }),
  erg('3030-x10', '30/30 Classic', '10 × 30 s at 120% FTP with 30 s recovery.', 2, 7, 220, intervals(10, 30, 120, 30)),
  // Tier 3 — levels 10–14
  erg('tabata', 'Tabata', '8 × 20 s at 150% FTP with 10 s rest. Very short and very hard.', 3, 10, 300, intervals(8, 20, 150, 10, 40)),
  erg('4x4', 'Norwegian 4×4', '4 × 4 min at 110% FTP with 3 min recovery.', 3, 11, 350, intervals(4, 240, 110, 180)),
  free('best-minute', 'Minute Man', 'Average 120% of FTP for one full minute.', 3, 12, 300, 120, {
    kind: 'bestAvg',
    windowSec: 60,
    pctFtp: 120,
  }, 120),
  // Tier 4 — levels 15+
  erg('3x8', 'Threshold Triple', '3 × 8 min at 105% FTP with 4 min recovery.', 4, 15, 450, intervals(3, 480, 105, 240)),
  free('hold-5', 'Five Minute Fire', 'Average 105% of FTP for 5 minutes. Pace it.', 4, 16, 450, 420, {
    kind: 'bestAvg',
    windowSec: 300,
    pctFtp: 105,
  }, 105),
  erg('over-unders', 'Over-Unders', '3 blocks of (2 min at 95%, then 1 min at 110%) × 3.', 4, 18, 500, [
    ...Array.from({ length: 3 }, (_, b) => [
      ...Array.from({ length: 3 }, (_, i): Step[] => [
        { label: `Block ${b + 1} · under ${i + 1}`, kind: 'work', durationSec: 120, mode: 'erg', targetPctFtp: 95 },
        { label: `Block ${b + 1} · over ${i + 1}`, kind: 'work', durationSec: 60, mode: 'erg', targetPctFtp: 110 },
      ]).flat(),
      { label: 'Recover', kind: 'rest', durationSec: 240, mode: 'erg', targetPctFtp: 50 } as Step,
    ]).flat(),
  ]),
];

/** Promotion challenge that unlocks progress past `gateLevel` (5, 10, 15, …). Difficulty scales with the gate. */
export function promotionChallenge(gateLevel: number): Challenge {
  const n = gateLevel / PROMOTION_EVERY; // 1, 2, 3…
  const reps = Math.min(3 + n, 8);
  const pct = Math.min(105 + 3 * n, 125);
  const workSec = Math.min(90 + 30 * n, 300);
  return {
    id: `promo-${gateLevel}`,
    name: `Promotion Trial ${roman(n)}`,
    description: `Pass this to move past level ${gateLevel}: ${reps} × ${fmtDur(workSec)} at ${pct}% FTP. If you stop pedalling, you fail.`,
    tier: n,
    minLevel: gateLevel,
    xpReward: 250 + 150 * n,
    promotionFor: gateLevel,
    repeatable: false,
    steps: [...warmup(6), ...intervals(reps, workSec, pct, 120), ...cooldown()],
    success: { kind: 'completeAll' },
  };
}

export function challengeById(id: string): Challenge | undefined {
  if (id.startsWith('promo-')) return promotionChallenge(Number(id.slice(6)));
  return CHALLENGES.find((c) => c.id === id);
}

/** Pick today's bounty from the challenges unlocked at `level` (deterministic per date). */
export function dailyBounty(level: number, date = new Date()): Challenge | undefined {
  const pool = CHALLENGES.filter((c) => c.minLevel <= level && c.id !== RAMP_TEST.id);
  if (!pool.length) return undefined;
  const key = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  let h = key;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) >>> 0;
  return pool[h % pool.length];
}

export const totalDurationSec = (c: Challenge) => c.steps.reduce((a, s) => a + s.durationSec, 0);

export function fmtDur(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  return s === 0 ? `${m} min` : `${m}:${String(s).padStart(2, '0')}`;
}

function roman(n: number): string {
  const map: [number, string][] = [
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}
