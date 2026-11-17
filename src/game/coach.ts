import { RAMP_TEST, WORKOUTS, challengeById, totalDurationSec, type Challenge, type WorkoutCategory } from './challenges';

/**
 * The coach: training load (fitness / fatigue / form) and "today's ride".
 * Pure functions over saved rides so it is easy to test and to extend with goals and availability later.
 */

/** The parts of a saved ride the coach needs (a subset of persistence's RideSummary). */
export interface RideLog {
  startedAt: number;
  durationSec: number;
  /** training stress; older rides without it are estimated from zone time */
  tss?: number;
  /** seconds per power zone, index 0 = Z1 */
  zoneSec: number[];
  challenges: { id: string; passed: boolean }[];
}

export interface CoachProfile {
  ftp: number;
  ftpHistory: { at: number; ftp: number }[];
  completed: Record<string, { count: number }>;
  rides: RideLog[];
}

// ---- training load --------------------------------------------------------

/** Representative intensity (fraction of FTP) for each Coggan zone, for estimating TSS from zone time. */
const ZONE_IF = [0.45, 0.65, 0.83, 0.98, 1.13, 1.35, 2.0];

export function rideTss(r: RideLog): number {
  if (r.tss != null) return r.tss;
  const sum = r.zoneSec.reduce((a, sec, i) => a + sec * ZONE_IF[i] ** 2, 0);
  return Math.round((sum / 3600) * 100);
}

/** Local calendar day number (days since epoch in local time), so "yesterday" means the user's yesterday. */
export function dayIndex(ms: number): number {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

export interface TrainingLoad {
  /** chronic training load: 42-day average daily TSS */
  fitness: number;
  /** acute training load: 7-day average daily TSS */
  fatigue: number;
  /** fitness − fatigue as of the end of yesterday; negative = tired */
  form: number;
  formLabel: 'Fresh' | 'Neutral' | 'Building' | 'Overreaching';
  todayTss: number;
  /** TSS over the last 7 days, including today */
  weekTss: number;
}

const CTL_DAYS = 42;
const ATL_DAYS = 7;

export function trainingLoad(rides: RideLog[], now = Date.now()): TrainingLoad {
  const today = dayIndex(now);
  const daily = new Map<number, number>();
  for (const r of rides) daily.set(dayIndex(r.startedAt), (daily.get(dayIndex(r.startedAt)) ?? 0) + rideTss(r));
  const first = Math.min(today, ...daily.keys());
  let ctl = 0;
  let atl = 0;
  let form = 0;
  for (let d = first; d <= today; d++) {
    if (d === today) form = ctl - atl;
    const tss = daily.get(d) ?? 0;
    ctl += (tss - ctl) / CTL_DAYS;
    atl += (tss - atl) / ATL_DAYS;
  }
  let weekTss = 0;
  for (let d = today - 6; d <= today; d++) weekTss += daily.get(d) ?? 0;
  return {
    fitness: Math.round(ctl),
    fatigue: Math.round(atl),
    form: Math.round(form),
    formLabel: form > 5 ? 'Fresh' : form >= -10 ? 'Neutral' : form >= -30 ? 'Building' : 'Overreaching',
    todayTss: Math.round(daily.get(today) ?? 0),
    weekTss: Math.round(weekTss),
  };
}

// ---- intensity history ----------------------------------------------------

const HARD_CATEGORIES: WorkoutCategory[] = ['sweetspot', 'threshold', 'vo2max', 'tempo', 'anaerobic', 'sprint'];

/** Ideal days between sessions of each hard category; the most "overdue" one is picked next. */
const SPACING_DAYS: Record<string, number> = { sweetspot: 4, threshold: 7, vo2max: 7, tempo: 10, anaerobic: 14, sprint: 14 };

/** At most this many hard days in the last 7, i.e. keep most riding easy (roughly 80/20). */
export const HARD_DAYS_PER_WEEK = 3;

/** A ride counts as hard if it included a hard workout or challenge, or enough time at threshold or above. */
export function isHardRide(r: RideLog): boolean {
  for (const c of r.challenges) {
    const ch = challengeById(c.id);
    if (!ch) continue;
    if (!ch.workout) return true; // challenges and the ramp test are all hard efforts
    if (HARD_CATEGORIES.includes(ch.workout.category)) return true;
  }
  const z4plus = r.zoneSec.slice(3).reduce((a, b) => a + b, 0);
  const z5plus = r.zoneSec.slice(4).reduce((a, b) => a + b, 0);
  return z4plus >= 600 || z5plus >= 180;
}

interface Attempt {
  workout: Challenge;
  passed: boolean;
  day: number;
}

function workoutAttempts(rides: RideLog[]): Attempt[] {
  const out: Attempt[] = [];
  for (const r of [...rides].sort((a, b) => a.startedAt - b.startedAt)) {
    for (const c of r.challenges) {
      const w = challengeById(c.id);
      if (w?.workout) out.push({ workout: w, passed: c.passed, day: dayIndex(r.startedAt) });
    }
  }
  return out;
}

// ---- picking ----------------------------------------------------------------

const ladder = (cat: WorkoutCategory) =>
  WORKOUTS.filter((w) => w.workout!.category === cat).sort((a, b) => a.workout!.rung - b.workout!.rung);
const minutes = (c: Challenge) => totalDurationSec(c) / 60;

/** Until riders set their availability, keep weekday sessions under this, and allow longer rides at weekends. */
export const WEEKDAY_MAX_MIN = 75;
export const WEEKEND_MAX_MIN = 120;
const SHORT_MIN = 35;

export type SuggestionKind = 'test' | 'rest' | 'recovery' | 'endurance' | 'hard';

export interface Suggestion {
  workout: Challenge;
  kind: SuggestionKind;
  reason: string;
}

/**
 * Next rung for a category: one up after a completed session, the same rung after one that was ended early,
 * and the first full-length rung if it has never been ridden. Never longer than `maxMin`.
 */
function progressIn(cat: WorkoutCategory, attempts: Attempt[], maxMin: number, filter: (w: Challenge) => boolean = () => true) {
  const rungs = ladder(cat).filter(filter);
  const last = [...attempts].reverse().find((a) => a.workout.workout!.category === cat && filter(a.workout));
  let idx: number;
  let why: string;
  if (!last) {
    idx = Math.max(0, rungs.findIndex((w) => minutes(w) > SHORT_MIN));
    why = 'A good first step on this ladder.';
  } else {
    const at = Math.max(0, rungs.findIndex((w) => w.id === last.workout.id));
    idx = last.passed ? Math.min(at + 1, rungs.length - 1) : at;
    why = last.passed
      ? idx > at
        ? `One step up from ${last.workout.name}.`
        : `You've reached the top of this ladder. Nice!`
      : `Another go at ${last.workout.name}; you ended it early last time.`;
  }
  while (idx > 0 && minutes(rungs[idx]) > maxMin) idx--;
  return { workout: rungs[idx], why };
}

const daysAgo = (n: number) => (n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);

export function suggestToday(p: CoachProfile, now = Date.now()): Suggestion {
  const today = dayIndex(now);
  const dow = new Date(now).getDay();
  const weekend = dow === 0 || dow === 6;
  const maxMin = weekend ? WEEKEND_MAX_MIN : WEEKDAY_MAX_MIN;
  const load = trainingLoad(p.rides, now);
  const attempts = workoutAttempts(p.rides);
  const recovery = challengeById('wk-recovery-30')!;

  // 1. Untested FTP: every target depends on it.
  if (p.ftpHistory.length === 0 && (p.completed[RAMP_TEST.id]?.count ?? 0) === 0) {
    return {
      workout: RAMP_TEST,
      kind: 'test',
      reason: "Your FTP hasn't been tested yet. Take the Ramp Test first so every workout's targets fit you.",
    };
  }

  // 2. Already trained today.
  if (load.todayTss >= 30) {
    return {
      workout: recovery,
      kind: 'rest',
      reason: `You've already trained today (${load.todayTss} TSS). Rest is part of training. If you want to ride, keep it very easy.`,
    };
  }

  // 3. Deep fatigue.
  if (load.form < -30) {
    return {
      workout: recovery,
      kind: 'recovery',
      reason: `Your fatigue is high (form ${load.form}). An easy spin today lets the training sink in.`,
    };
  }

  const hardDays = new Set(p.rides.filter((r) => dayIndex(r.startedAt) < today && isHardRide(r)).map((r) => dayIndex(r.startedAt)));
  const hardThisWeek = [...hardDays].filter((d) => d >= today - 7).length;
  const pureZ2 = (w: Challenge) => w.workout!.trains.length === 1 && w.workout!.trains[0] === 'endurance' && w.workout!.focus === 'Zone 2';
  const easy = (reason: string): Suggestion => {
    const { workout } = progressIn('endurance', attempts, Math.min(maxMin, weekend ? WEEKEND_MAX_MIN : 60), pureZ2);
    return { workout, kind: 'endurance', reason };
  };

  // 4. No history yet: start easy.
  if (p.rides.length === 0) {
    return easy('Welcome! Start with an easy Zone 2 ride to get a feel for ERG. The trainer sets the watts, so just pedal.');
  }

  // 5. Hard yesterday → easy today.
  if (hardDays.has(today - 1)) {
    return easy('You went hard yesterday. Easy Zone 2 today helps you recover and absorb it.');
  }

  // 6. Intensity budget used up.
  if (hardThisWeek >= HARD_DAYS_PER_WEEK) {
    return easy(`You've had ${hardThisWeek} hard days this week. Keep the rest easy: most of your riding should be in Zone 2.`);
  }

  // 7. Weekend with room for a long ride, if one hasn't happened this week.
  const longThisWeek = p.rides.some((r) => dayIndex(r.startedAt) >= today - 6 && r.durationSec >= 80 * 60);
  if (weekend && !longThisWeek && hardThisWeek >= 1) {
    const { workout, why } = progressIn('endurance', attempts, WEEKEND_MAX_MIN, (w) => pureZ2(w) && minutes(w) >= 60);
    return { workout, kind: 'endurance', reason: `Weekend: time for a longer Zone 2 ride to grow your aerobic base. ${why}` };
  }

  // 8. Hard day: pick the most overdue category.
  const lastDay = (cat: WorkoutCategory) => {
    const a = [...attempts].reverse().find((x) => x.workout.workout!.category === cat);
    return a ? a.day : null;
  };
  let best: WorkoutCategory = HARD_CATEGORIES[0];
  let bestScore = -Infinity;
  HARD_CATEGORIES.forEach((cat, i) => {
    const d = lastDay(cat);
    // never ridden → exactly due; ties go to earlier (more important) categories
    const score = d == null ? 1 + (HARD_CATEGORIES.length - i) / 100 : (today - d) / SPACING_DAYS[cat];
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  });
  const { workout, why } = progressIn(best, attempts, maxMin);
  const d = lastDay(best);
  const label = workout.workout!.focus;
  const due = d == null ? `Time to try some ${label.toLowerCase()} work.` : `${label} is due: your last session was ${daysAgo(today - d)}.`;
  return { workout, kind: 'hard', reason: `${due} ${why}` };
}

// ---- swaps ------------------------------------------------------------------

export interface Swaps {
  shorter: Challenge | null;
  easier: Challenge | null;
  harder: Challenge | null;
}

export function swapsFor(c: Challenge): Swaps {
  if (!c.workout) {
    // The ramp test: the only alternative is an easy ride.
    return { shorter: null, easier: challengeById('wk-z2-45') ?? null, harder: null };
  }
  const rungs = ladder(c.workout.category);
  const i = rungs.findIndex((w) => w.id === c.id);
  const shorterOpts = rungs.filter((w) => minutes(w) <= minutes(c) - 10);
  const easier = i > 0 ? rungs[i - 1] : c.workout.category === 'endurance' ? null : challengeById('wk-z2-45')!;
  return {
    shorter: shorterOpts.length ? shorterOpts[shorterOpts.length - 1] : null,
    easier,
    harder: i < rungs.length - 1 ? rungs[i + 1] : null,
  };
}
