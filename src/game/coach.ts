import { RAMP_TEST, WORKOUTS, challengeById, roman, totalDurationSec, type Challenge, type WorkoutCategory } from './challenges';
import { coachInsights, isCadenceInsight, type Insight } from './insights';
import type { RideMetrics } from './rideMetrics';

/**
 * The coach: training load (fitness / fatigue / form) and "today's ride".
 * Pure functions over saved rides so it is easy to test and to extend with goals and availability later.
 */

/** Post-workout check-in: how hard the session felt. */
export type Feel = 'easy' | 'right' | 'hard';

/** The parts of a saved ride the coach needs (a subset of persistence's RideSummary). */
export interface RideLog {
  startedAt: number;
  durationSec: number;
  /** training stress; older rides without it are estimated from zone time */
  tss?: number;
  /** seconds per power zone, index 0 = Z1 */
  zoneSec: number[];
  challenges: { id: string; passed: boolean; feel?: Feel }[];
  /** post-ride check-in for the ride as a whole */
  feel?: Feel;
  /** cadence and heart-rate numbers for spotting trends; missing on older rides */
  metrics?: RideMetrics;
}

/** What the rider has told the coach about its suggestions. */
export interface CoachState {
  /** when the rider last said "not now" to raising or retesting their FTP */
  ftpNudgeDismissedAt?: number;
}

export interface CoachProfile {
  ftp: number;
  ftpHistory: { at: number; ftp: number }[];
  completed: Record<string, { count: number }>;
  rides: RideLog[];
  plan?: TrainingPlan;
  promotions?: Promotion[];
  coach?: CoachState;
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
  feel?: Feel;
  day: number;
}

function workoutAttempts(rides: RideLog[]): Attempt[] {
  const out: Attempt[] = [];
  for (const r of [...rides].sort((a, b) => a.startedAt - b.startedAt)) {
    for (const c of r.challenges) {
      const w = challengeById(c.id);
      if (w?.workout) out.push({ workout: w, passed: c.passed, feel: c.feel, day: dayIndex(r.startedAt) });
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
  /** the trend that shaped this suggestion, if one did */
  insight?: Insight;
}

// ---- goals and plans --------------------------------------------------------

export type GoalId = 'fitness' | 'base' | 'ftp' | 'event';

export interface TrainingPlan {
  goal: GoalId;
  /** minutes available per weekday, index 0 = Sunday … 6 = Saturday; 0 = rest day */
  minutesByDay: number[];
  /** local date YYYY-MM-DD, for the event goal */
  eventDate?: string;
  createdAt: number;
}

export interface Goal {
  name: string;
  blurb: string;
  /** most hard days in any 7 */
  hardPerWeek: number;
  /** typical training stress per hour of riding, for the weekly target */
  tssPerHour: number;
  /** hard categories in priority order, with ideal days between sessions */
  categories: [WorkoutCategory, number][];
}

/** Used when no plan is set. */
const DEFAULT_RULES: Goal = {
  name: 'No plan',
  blurb: '',
  hardPerWeek: 3,
  tssPerHour: 55,
  categories: [['sweetspot', 4], ['threshold', 7], ['vo2max', 7], ['tempo', 10], ['anaerobic', 14], ['sprint', 14]],
};

export const GOALS: Record<GoalId, Goal> = {
  fitness: {
    name: 'Get fitter',
    blurb: 'All-round fitness: plenty of Zone 2 plus two varied key workouts a week.',
    hardPerWeek: 2,
    tssPerHour: 55,
    categories: [['sweetspot', 5], ['vo2max', 7], ['threshold', 10], ['tempo', 10], ['anaerobic', 14], ['sprint', 14]],
  },
  base: {
    name: 'Build endurance',
    blurb: 'Mostly Zone 2 to grow your aerobic engine, with one tempo or sweet spot session a week.',
    hardPerWeek: 1,
    tssPerHour: 50,
    categories: [['tempo', 7], ['sweetspot', 7], ['threshold', 21], ['vo2max', 21]],
  },
  ftp: {
    name: 'Raise my FTP',
    blurb: 'Sweet spot and threshold work, topped up with VO₂max, to push your FTP up.',
    hardPerWeek: 3,
    tssPerHour: 60,
    categories: [['sweetspot', 4], ['threshold', 7], ['vo2max', 10], ['tempo', 14], ['anaerobic', 21]],
  },
  event: {
    name: 'Prepare for an event',
    blurb: 'Threshold, VO₂max and punch for race day, with a long ride each week and a taper before the event.',
    hardPerWeek: 2,
    tssPerHour: 58,
    categories: [['threshold', 7], ['vo2max', 7], ['sweetspot', 7], ['anaerobic', 10], ['sprint', 14], ['tempo', 14]],
  },
};

export const DEFAULT_MINUTES_BY_DAY = [60, 0, 60, 45, 60, 0, 90]; // Sun … Sat

/** Hard days allowed per week: the goal's number, but never more than about every other riding day. */
export function hardPerWeek(plan: TrainingPlan | undefined): number {
  if (!plan) return DEFAULT_RULES.hardPerWeek;
  const days = plan.minutesByDay.filter((m) => m > 0).length;
  return Math.max(1, Math.min(GOALS[plan.goal].hardPerWeek, Math.ceil(days / 2)));
}

export function weeklyTargetTss(plan: TrainingPlan): number {
  const hours = plan.minutesByDay.reduce((a, m) => a + m, 0) / 60;
  return Math.round((hours * GOALS[plan.goal].tssPerHour) / 10) * 10;
}

/** 0 = Sunday … 6 = Saturday, for a local day index. */
export const weekday = (day: number) => (((day + 4) % 7) + 7) % 7;
/** Day index of the Monday starting the week that contains `day`. */
export const weekStart = (day: number) => day - ((weekday(day) + 6) % 7);

// ---- training blocks ---------------------------------------------------------
// A plan runs in 4-week blocks: three build weeks with rising load, then a recovery week that ends with an
// FTP retest. Passing the retest promotes the rider.

export const BLOCK_WEEKS = 4;
/** Weekly load relative to the plan's base target, per week of the block. */
export const BLOCK_WEEK_LOAD = [1.0, 1.08, 1.15, 0.65];
/** The retest window: the last RETEST_DAYS days of a block plus the first RETEST_DAYS of the next. */
export const RETEST_DAYS = 3;

export interface Promotion {
  /** which plan the block belonged to (its createdAt) */
  planCreatedAt: number;
  block: number;
  at: number;
  oldFtp: number;
  newFtp: number;
}

export interface BlockInfo {
  /** 1-based block number since the plan started */
  number: number;
  /** 1-based week within the block */
  week: number;
  recovery: boolean;
  /** day within the block, 0…27 */
  dayInBlock: number;
  /** block whose retest is open today, if any */
  retestFor: number | null;
}

export const blockInfo = (plan: TrainingPlan, now = Date.now()): BlockInfo => blockInfoForDay(plan, dayIndex(now));

function blockInfoForDay(plan: TrainingPlan, day: number): BlockInfo {
  const start = weekStart(dayIndex(plan.createdAt));
  const days = Math.max(0, day - start);
  const len = BLOCK_WEEKS * 7;
  const number = Math.floor(days / len) + 1;
  const dayInBlock = days % len;
  const week = Math.floor(dayInBlock / 7) + 1;
  const retestFor = dayInBlock >= len - RETEST_DAYS ? number : dayInBlock < RETEST_DAYS && number > 1 ? number - 1 : null;
  return { number, week, recovery: week === BLOCK_WEEKS, dayInBlock, retestFor };
}

/** Load factor for the week containing `day` (1 before the plan started). */
function weekLoad(plan: TrainingPlan, day: number): number {
  if (day < weekStart(dayIndex(plan.createdAt))) return 1;
  return BLOCK_WEEK_LOAD[blockInfoForDay(plan, day).week - 1];
}

export const isPromoted = (promotions: Promotion[] | undefined, plan: TrainingPlan, block: number) =>
  !!promotions?.some((p) => p.planCreatedAt === plan.createdAt && p.block === block);

export interface WeekDay {
  day: number;
  weekday: number;
  plannedMin: number;
  tss: number;
  isToday: boolean;
}

export interface WeekProgress {
  tss: number;
  target: number;
  days: WeekDay[];
  /** consecutive weeks (ending now) that reached at least STREAK_FRACTION of the target */
  streak: number;
  /** this week already counts towards the streak */
  thisWeekDone: boolean;
}

/** A week counts for the streak at 80% of its target, so one missed ride doesn't break it. */
export const STREAK_FRACTION = 0.8;

export function weekProgress(rides: RideLog[], plan: TrainingPlan, now = Date.now()): WeekProgress {
  const today = dayIndex(now);
  const daily = new Map<number, number>();
  for (const r of rides) daily.set(dayIndex(r.startedAt), (daily.get(dayIndex(r.startedAt)) ?? 0) + rideTss(r));
  const base = weeklyTargetTss(plan);
  const targetFor = (weekStartDay: number) => Math.round((base * weekLoad(plan, weekStartDay)) / 10) * 10;
  const weekTss = (start: number) => {
    let t = 0;
    for (let d = start; d < start + 7; d++) t += daily.get(d) ?? 0;
    return t;
  };
  const start = weekStart(today);
  const target = targetFor(start);
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const day = start + i;
    return { day, weekday: weekday(day), plannedMin: plan.minutesByDay[weekday(day)], tss: Math.round(daily.get(day) ?? 0), isToday: day === today };
  });
  const tss = Math.round(weekTss(start));
  const thisWeekDone = target > 0 && tss >= target * STREAK_FRACTION;
  let streak = thisWeekDone ? 1 : 0;
  for (let w = start - 7; w >= start - 7 * 104; w -= 7) {
    const t = targetFor(w);
    if (t > 0 && weekTss(w) >= t * STREAK_FRACTION) streak++;
    else break;
  }
  return { tss, target, days, streak, thisWeekDone };
}

// ---- picking ------------------------------------------------------------------

/**
 * Next rung for a category, from the last attempt and its check-in:
 * - completed and felt easy → two rungs up; felt right (or no check-in) → one up; felt hard → repeat it
 * - ended early → repeat it; ended early twice in a row → one rung down
 * - never ridden → the first full-length rung.
 * Never longer than `maxMin` if avoidable.
 */
function progressIn(cat: WorkoutCategory, attempts: Attempt[], maxMin: number, filter: (w: Challenge) => boolean = () => true) {
  const rungs = ladder(cat).filter(filter);
  const inCat = attempts.filter((a) => a.workout.workout!.category === cat && filter(a.workout));
  const last = inCat[inCat.length - 1];
  const prev = inCat[inCat.length - 2];
  let idx: number;
  let why: string;
  if (!last) {
    idx = Math.max(0, rungs.findIndex((w) => minutes(w) > SHORT_MIN));
    why = 'A good first step on this ladder.';
  } else {
    const at = Math.max(0, rungs.findIndex((w) => w.id === last.workout.id));
    const top = rungs.length - 1;
    const name = last.workout.name;
    if (!last.passed) {
      if (prev && !prev.passed && at > 0) {
        idx = at - 1;
        why = `${name} has been tough twice, so one step back to build up to it.`;
      } else {
        idx = at;
        why = `Another go at ${name}; you ended it early last time.`;
      }
    } else if (last.feel === 'hard') {
      idx = at;
      why = `${name} felt hard last time, so repeat it to lock in the gains.`;
    } else {
      idx = Math.min(at + (last.feel === 'easy' ? 2 : 1), top);
      why =
        idx === at
          ? `You've reached the top of this ladder. Nice!`
          : last.feel === 'easy'
            ? `${name} felt easy, so two steps up.`
            : `One step up from ${name}.`;
    }
  }
  const wanted = idx;
  while (idx > 0 && minutes(rungs[idx]) > maxMin) idx--;
  if (idx < wanted) why = `${rungs[idx].name} fits the ${Math.round(maxMin)} minutes you have today.`;
  return { workout: rungs[idx], why };
}

const daysAgo = (n: number) => (n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);
const parseDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
};

const pureZ2 = (w: Challenge) => w.workout!.trains.length === 1 && w.workout!.trains[0] === 'endurance' && w.workout!.focus === 'Zone 2';

/** Longest plain Zone 2 ride that fits in `maxMin` (or the shortest one if none fits). */
function fitZ2(maxMin: number): Challenge {
  const rides = ladder('endurance').filter(pureZ2);
  const fits = rides.filter((w) => minutes(w) <= maxMin);
  return fits.length ? fits[fits.length - 1] : rides[0];
}

/** The coach's current opinions about the rider's trends, most important first. */
export function coachNotes(p: CoachProfile, now = Date.now()): Insight[] {
  return coachInsights(
    { ftp: p.ftp, ftpHistory: p.ftpHistory, rides: p.rides, form: trainingLoad(p.rides, now).form, ftpNudgeDismissedAt: p.coach?.ftpNudgeDismissedAt },
    now,
  );
}

const SPIN_UPS = 'wk-z2-cadence';

export function suggestToday(p: CoachProfile, now = Date.now()): Suggestion {
  const today = dayIndex(now);
  const dow = weekday(today);
  const plan = p.plan;
  const rules = plan ? GOALS[plan.goal] : DEFAULT_RULES;
  const weekend = dow === 0 || dow === 6;
  const block = plan ? blockInfo(plan, now) : null;
  const planned = plan ? plan.minutesByDay[dow] : weekend ? WEEKEND_MAX_MIN : WEEKDAY_MAX_MIN;
  // Recovery week: a quarter less riding time.
  const dayMin = block?.recovery ? Math.round(planned * 0.75) : planned;
  const load = trainingLoad(p.rides, now);
  const attempts = workoutAttempts(p.rides);
  const recovery = challengeById('wk-recovery-30')!;
  const daysToEvent = plan?.goal === 'event' && plan.eventDate ? dayIndex(parseDate(plan.eventDate)) - today : null;

  // 1. Untested FTP: every target depends on it.
  if (p.ftpHistory.length === 0 && (p.completed[RAMP_TEST.id]?.count ?? 0) === 0) {
    return {
      workout: RAMP_TEST,
      kind: 'test',
      reason: "Your FTP hasn't been tested yet. Take the Ramp Test first so every workout's targets fit you.",
    };
  }

  // 2. Event day and the days just before it.
  if (daysToEvent === 0) {
    return { workout: recovery, kind: 'rest', reason: "It's event day! No training today. Warm up well and enjoy it." };
  }
  if (daysToEvent === 1) {
    return {
      workout: challengeById('wk-sprint-6x10')!,
      kind: 'endurance',
      reason: 'Your event is tomorrow. A short session with a few sprints "opens" your legs without tiring them.',
    };
  }
  if (daysToEvent === 2) {
    return { workout: recovery, kind: 'recovery', reason: 'Two days to your event: keep it very easy so you arrive fresh.' };
  }

  // 3. Already trained today.
  if (load.todayTss >= 30) {
    return {
      workout: recovery,
      kind: 'rest',
      reason: `You've already trained today (${load.todayTss} TSS). Rest is part of training. If you want to ride, keep it very easy.`,
    };
  }

  // 4. Rest day in the plan.
  if (plan && dayMin === 0) {
    return { workout: recovery, kind: 'rest', reason: "Today is a rest day in your plan. If you'd like to ride anyway, keep it very easy." };
  }

  // 5. Deep fatigue.
  if (load.form < -30) {
    return {
      workout: recovery,
      kind: 'recovery',
      reason: `Your fatigue is high (form ${load.form}). An easy spin today lets the training sink in.`,
    };
  }

  // 5b. Trends that say back off: every recent ride felt really hard, or fatigue is holding heart rate down.
  const notes = coachNotes(p, now);
  const backOff = notes.find((n) => n.id === 'feel-hard' || n.id === 'tired-hr');
  if (backOff) {
    return { workout: recovery, kind: 'recovery', insight: backOff, reason: `${backOff.text} An easy spin today lets you catch up.` };
  }

  const hardDays = new Set(p.rides.filter((r) => dayIndex(r.startedAt) < today && isHardRide(r)).map((r) => dayIndex(r.startedAt)));

  // 6. End of a training block: FTP retest for promotion.
  if (plan && block?.retestFor && !isPromoted(p.promotions, plan, block.retestFor) && (daysToEvent == null || daysToEvent > 7)) {
    const rank = (p.promotions?.length ?? 0) + 1;
    return {
      workout: RAMP_TEST,
      kind: 'test',
      reason: `Training block ${block.retestFor} is done. Retest your FTP: pass the Ramp Test to be promoted to Rank ${roman(rank)} and reset your targets to your new fitness.`,
    };
  }

  // 6b. Trends say the FTP is too low: retest (or raise it) when fresh enough to test, outside a recovery week (which
  // ends in a retest anyway) and away from an event.
  const ftpLow = notes.find((n) => n.id === 'ftp-low');
  if (ftpLow && !block?.recovery && !hardDays.has(today - 1) && load.form >= -15 && (daysToEvent == null || daysToEvent > 7)) {
    return {
      workout: RAMP_TEST,
      kind: 'test',
      insight: ftpLow,
      reason: `${ftpLow.text} Retest to set your new FTP, or raise it to ${ftpLow.raiseFtpTo} W if you'd rather not test today.`,
    };
  }

  const hardThisWeek = [...hardDays].filter((d) => d >= today - 7).length;
  const hardBudget = block?.recovery ? 1 : hardPerWeek(plan);
  const cadence = notes.find(isCadenceInsight);
  const spinUps = challengeById(SPIN_UPS)!;
  const easy = (reason: string): Suggestion => {
    if (cadence && (!plan || minutes(spinUps) <= dayMin)) {
      return { workout: spinUps, kind: 'endurance', insight: cadence, reason: `${reason} Spin-up drills today, because ${cadence.brief}.` };
    }
    if (plan) return { workout: fitZ2(Math.min(dayMin, 90)), kind: 'endurance', reason };
    const { workout } = progressIn('endurance', attempts, weekend ? WEEKEND_MAX_MIN : 60, pureZ2);
    return { workout, kind: 'endurance', reason };
  };

  // 6. No history yet: start easy.
  if (p.rides.length === 0) {
    return easy('Welcome! Start with an easy Zone 2 ride to get a feel for ERG. The trainer sets the watts, so just pedal.');
  }

  // 7. Hard yesterday → easy today.
  if (hardDays.has(today - 1)) {
    return easy('You went hard yesterday. Easy Zone 2 today helps you recover and absorb it.');
  }

  // 8. Intensity budget used up.
  if (block?.recovery && hardThisWeek >= hardBudget) {
    return easy('Recovery week: lighter training lets your body absorb the block, so you arrive fresh for your FTP retest.');
  }
  if (hardThisWeek >= hardBudget) {
    const days = hardThisWeek === 1 ? '1 hard day' : `${hardThisWeek} hard days`;
    return easy(`You've had ${days} in the last week${plan ? `, which is what your ${rules.name.toLowerCase()} plan calls for` : ''}. Keep the rest easy: most of your riding should be in Zone 2.`);
  }

  // 9. Long-ride day: the plan's longest day (or the weekend without a plan), once a week.
  const longMin = plan ? Math.max(...plan.minutesByDay) : WEEKEND_MAX_MIN;
  const isLongDay = plan ? dayMin === longMin && dayMin >= 75 : weekend && hardThisWeek >= 1;
  const longThisWeek = p.rides.some((r) => dayIndex(r.startedAt) >= today - 6 && r.durationSec >= Math.min(80, longMin * 0.8) * 60);
  if (isLongDay && !longThisWeek && (daysToEvent == null || daysToEvent > 7)) {
    if (plan) {
      return { workout: fitZ2(dayMin), kind: 'endurance', reason: `Long-ride day: you have ${dayMin} minutes, so it's time to grow your aerobic base.` };
    }
    const { workout, why } = progressIn('endurance', attempts, WEEKEND_MAX_MIN, (w) => pureZ2(w) && minutes(w) >= 60);
    return { workout, kind: 'endurance', reason: `Weekend: time for a longer Zone 2 ride to grow your aerobic base. ${why}` };
  }

  // 10. Key workout: the most overdue category for this goal. Shorter in the taper week.
  const taper = daysToEvent != null && daysToEvent > 0 && daysToEvent <= 7;
  const maxMin = taper ? Math.min(dayMin, 45) : dayMin;
  const lastDay = (cat: WorkoutCategory) => {
    const a = [...attempts].reverse().find((x) => x.workout.workout!.category === cat);
    return a ? a.day : null;
  };
  let best = rules.categories[0][0];
  let bestScore = -Infinity;
  rules.categories.forEach(([cat, spacing], i) => {
    const d = lastDay(cat);
    // never ridden → exactly due; ties go to earlier (more important) categories
    const score = d == null ? 1 + (rules.categories.length - i) / 100 : (today - d) / spacing;
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  });
  const { workout, why } = progressIn(best, attempts, maxMin);
  const d = lastDay(best);
  const label = workout.workout!.focus;
  const due = d == null ? `Time to try some ${label.toLowerCase()} work.` : `${label} is due: your last session was ${daysAgo(today - d)}.`;
  const taperNote = taper ? ` Taper week: shorter sessions so you're fresh in ${daysToEvent} days.` : '';
  return { workout, kind: 'hard', reason: `${due} ${why}${taperNote}` };
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
