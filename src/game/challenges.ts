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

export type WorkoutCategory = 'endurance' | 'sweetspot' | 'intervals';

export interface WorkoutInfo {
  category: WorkoutCategory;
  /** short physiological focus, e.g. "Zone 2" or "VO₂max" */
  focus: string;
  /** training stress score (TSS) when ridden as prescribed */
  tss: number;
}

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
  /**
   * Set for structured training workouts (as opposed to challenges). These can't be failed:
   * the clock pauses when you stop pedalling, and they pay full XP every time.
   */
  workout?: WorkoutInfo;
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

// ---- training workouts --------------------------------------------------
// Zones follow Coggan: Z2 endurance 56–75%, tempo 76–90%, sweet spot 88–94%, threshold 95–105%,
// VO₂max 106–120%, anaerobic 121%+. Warm-ups and cool-downs step gradually, as on a structured plan.

/** Stepped ramp from `fromPct` to `toPct` over `min` minutes, in ~2-minute steps. */
function ramp(label: string, kind: StepKind, min: number, fromPct: number, toPct: number): Step[] {
  const n = Math.max(1, Math.round(min / 2));
  const per = Math.round((min * 60) / n);
  return Array.from({ length: n }, (_, i) => ({
    label,
    kind,
    durationSec: per,
    mode: 'erg' as const,
    targetPctFtp: Math.round(n === 1 ? toPct : fromPct + ((toPct - fromPct) * i) / (n - 1)),
  }));
}
const wu = (min = 10) => ramp('Warm up', 'warmup', min, 50, 70);
const cd = (min = 6) => ramp('Cool down', 'cooldown', min, 62, 46);
const opener = (): Step[] => [
  { label: 'Opener', kind: 'warmup', durationSec: 60, mode: 'erg', targetPctFtp: 95 },
  { label: 'Easy', kind: 'warmup', durationSec: 120, mode: 'erg', targetPctFtp: 55 },
];

/** `reps` × work with recoveries between (no recovery after the last rep). */
function sets(label: string, reps: number, workSec: number, workPct: number, restSec: number, restPct = 55): Step[] {
  const out: Step[] = [];
  for (let i = 0; i < reps; i++) {
    out.push({ label: `${label} ${i + 1}/${reps}`, kind: 'work', durationSec: workSec, mode: 'erg', targetPctFtp: workPct });
    if (i < reps - 1) out.push({ label: 'Recover', kind: 'rest', durationSec: restSec, mode: 'erg', targetPctFtp: restPct });
  }
  return out;
}

/** Steady endurance riding split into blocks so progress is visible. */
function blocks(label: string, totalMin: number, blockMin: number, pct: number): Step[] {
  const n = Math.max(1, Math.round(totalMin / blockMin));
  const per = Math.round((totalMin * 60) / n);
  return Array.from({ length: n }, (_, i) => ({
    label: n > 1 ? `${label} ${i + 1}/${n}` : label,
    kind: 'work' as const,
    durationSec: per,
    mode: 'erg' as const,
    targetPctFtp: pct,
  }));
}

/** Training stress score: Σ duration × intensity² (FTP-relative), 100 = one hour at FTP. */
export function trainingStress(steps: Step[]): number {
  const sum = steps.reduce((a, s) => a + s.durationSec * ((s.targetPctFtp ?? 100) / 100) ** 2, 0);
  return Math.round((sum / 3600) * 100);
}

/** Workout XP is paid on every completion, so it scales with training load rather than novelty. */
export const WORKOUT_XP_PER_TSS = 2;

function workout(id: string, name: string, category: WorkoutCategory, focus: string, description: string, steps: Step[]): Challenge {
  const tss = trainingStress(steps);
  return {
    id,
    name,
    description,
    tier: 0,
    minLevel: 1,
    xpReward: Math.round((tss * WORKOUT_XP_PER_TSS) / 5) * 5,
    repeatable: true,
    steps,
    success: { kind: 'completeAll' },
    workout: { category, focus, tss },
  };
}

const endurance = (id: string, name: string, totalMin: number, description: string) =>
  workout(id, name, 'endurance', 'Zone 2', description, [...wu(8), ...blocks('Endurance', totalMin - 14, 20, 70), ...cd(6)]);

export const WORKOUTS: Challenge[] = [
  // Endurance / Zone 2
  workout('wk-recovery-30', 'Recovery Spin', 'endurance', 'Recovery',
    'Thirty very easy minutes for the day after a hard session. It gets blood flowing without adding fatigue. Keep it truly easy.',
    [...ramp('Easy spin', 'warmup', 4, 45, 50), ...blocks('Easy spin', 22, 22, 50), ...ramp('Cool down', 'cooldown', 4, 48, 42)]),
  endurance('wk-z2-45', 'Endurance 45', 45,
    'A short Zone 2 ride at 70% FTP. It builds aerobic base and fat burning. You should be able to talk the whole time.'),
  endurance('wk-z2-60', 'Endurance 60', 60,
    'One hour of steady Zone 2. Riding this two or three times a week is the foundation of every training plan.'),
  endurance('wk-z2-90', 'Endurance 90', 90,
    "Ninety minutes of Zone 2. Longer rides build more mitochondria and capillaries. Bring a bottle; the clock pauses if you stop pedalling."),
  endurance('wk-z2-120', 'Long Ride', 120,
    'Two hours in Zone 2, the indoor version of the weekend long ride. Eat and drink as you go.'),
  workout('wk-z2-cadence', 'Endurance + Spin-ups', 'endurance', 'Zone 2 · Cadence',
    'Zone 2 with a 1-minute high-cadence drill every 6 minutes. When a spin-up starts, shift to an easy gear and spin at 100+ rpm. ERG holds the watts.',
    [
      ...wu(8),
      ...Array.from({ length: 7 }, (_, i): Step[] => [
        { label: `Endurance ${i + 1}/7`, kind: 'work', durationSec: 300, mode: 'erg', targetPctFtp: 68 },
        { label: 'Spin-up: 100+ rpm', kind: 'work', durationSec: 60, mode: 'erg', targetPctFtp: 65 },
      ]).flat(),
      ...cd(6),
    ]),
  workout('wk-z2-tempo', 'Endurance + Tempo', 'endurance', 'Zone 2 · Tempo',
    'A long Zone 2 ride with three 8-minute tempo blocks at 83%. It builds the muscular endurance you need to ride long and steady.',
    [
      ...wu(8),
      ...blocks('Endurance', 15, 15, 70),
      ...sets('Tempo', 3, 480, 83, 300, 65),
      ...blocks('Endurance', 15, 15, 70),
      ...cd(6),
    ]),

  // Sweet spot
  workout('wk-ss-3x10', 'Sweet Spot 3×10', 'sweetspot', 'Sweet spot',
    'Three 10-minute blocks at 90% FTP. Sweet spot gives the most fitness for the time spent. Start here if sweet spot is new to you.',
    [...wu(10), ...opener(), ...sets('Sweet spot', 3, 600, 90, 300), ...cd(6)]),
  workout('wk-ss-4x10', 'Sweet Spot 4×10', 'sweetspot', 'Sweet spot',
    'Four 10-minute blocks at 90% FTP with 5 minutes easy between. The next step up from 3×10.',
    [...wu(10), ...opener(), ...sets('Sweet spot', 4, 600, 90, 300), ...cd(6)]),
  workout('wk-ss-3x15', 'Sweet Spot 3×15', 'sweetspot', 'Sweet spot',
    'Three 15-minute blocks at 91% FTP. Longer efforts build the ability to hold a strong pace.',
    [...wu(10), ...opener(), ...sets('Sweet spot', 3, 900, 91, 300), ...cd(6)]),
  workout('wk-ss-2x20', 'Sweet Spot 2×20', 'sweetspot', 'Sweet spot',
    'The classic: two 20-minute blocks at 90% FTP. Settle in, keep a steady cadence and stay relaxed.',
    [...wu(10), ...opener(), ...sets('Sweet spot', 2, 1200, 90, 480), ...cd(6)]),
  workout('wk-ss-progressive', 'Sweet Spot Climb', 'sweetspot', 'Sweet spot',
    'Three 12-minute blocks that each climb from 88% to 91% to 94% FTP. They finish right below threshold.',
    [
      ...wu(10),
      ...opener(),
      ...Array.from({ length: 3 }, (_, i): Step[] => [
        { label: `Block ${i + 1}/3 · 88%`, kind: 'work', durationSec: 240, mode: 'erg', targetPctFtp: 88 },
        { label: `Block ${i + 1}/3 · 91%`, kind: 'work', durationSec: 240, mode: 'erg', targetPctFtp: 91 },
        { label: `Block ${i + 1}/3 · 94%`, kind: 'work', durationSec: 240, mode: 'erg', targetPctFtp: 94 },
        ...(i < 2 ? [{ label: 'Recover', kind: 'rest', durationSec: 300, mode: 'erg', targetPctFtp: 55 } as Step] : []),
      ]).flat(),
      ...cd(6),
    ]),

  // Intervals
  workout('wk-thr-3x10', 'Threshold 3×10', 'intervals', 'Threshold',
    'Three 10-minute efforts at 98% FTP with 5 minutes easy between. Raises the power you can hold for an hour.',
    [...wu(12), ...opener(), ...sets('Threshold', 3, 600, 98, 300), ...cd(8)]),
  workout('wk-vo2-5x3', 'VO₂max 5×3', 'intervals', 'VO₂max',
    'Five 3-minute efforts at 115% FTP with 3 minutes easy between. Raises your aerobic ceiling. Hard but short.',
    [...wu(12), ...opener(), ...sets('VO₂max', 5, 180, 115, 180, 50), ...cd(8)]),
  workout('wk-vo2-3015', 'VO₂max 30/15s', 'intervals', 'VO₂max',
    "Three sets of 13 × (30 s at 120%, 15 s easy), with 3 minutes between sets. The short rests keep your heart rate high, so you spend more time near VO₂max than in longer intervals.",
    [
      ...wu(12),
      ...opener(),
      ...Array.from({ length: 3 }, (_, set): Step[] => [
        ...Array.from({ length: 13 }, (_, i): Step[] => [
          { label: `Set ${set + 1}/3 · ${i + 1}/13`, kind: 'work', durationSec: 30, mode: 'erg', targetPctFtp: 120 },
          ...(i < 12 ? [{ label: 'Float', kind: 'rest', durationSec: 15, mode: 'erg', targetPctFtp: 50 } as Step] : []),
        ]).flat(),
        ...(set < 2 ? [{ label: 'Recover', kind: 'rest', durationSec: 180, mode: 'erg', targetPctFtp: 50 } as Step] : []),
      ]).flat(),
      ...cd(8),
    ]),
  workout('wk-ana-8x30', 'Anaerobic 8×30s', 'intervals', 'Anaerobic',
    'Eight 30-second efforts at 160% FTP with 3½ minutes easy between. Builds punch for attacks, short climbs and sprints.',
    [...wu(12), ...opener(), ...sets('Punch', 8, 30, 160, 210, 50), ...cd(8)]),
];

export function challengeById(id: string): Challenge | undefined {
  if (id.startsWith('promo-')) return promotionChallenge(Number(id.slice(6)));
  return CHALLENGES.find((c) => c.id === id) ?? WORKOUTS.find((c) => c.id === id);
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
