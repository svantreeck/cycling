import { challengeById } from './challenges';
import {
  blockInfo,
  dayIndex,
  hardPerWeek,
  isHardRide,
  rideTss,
  suggestToday,
  swapsFor,
  trainingLoad,
  weekday,
  weeklyTargetTss,
  weekProgress,
  weekStart,
  type CoachProfile,
  type RideLog,
  type TrainingPlan,
} from './coach';

const WED = new Date(2026, 10, 18, 12).getTime(); // Wednesday
const SAT = new Date(2026, 10, 21, 12).getTime(); // Saturday
const DAY = 86_400_000;

/** A ride `daysBefore` days before `now` with an optional workout/challenge attempt. */
function ride(now: number, daysBefore: number, opts: { id?: string; passed?: boolean; tss?: number; min?: number; zoneSec?: number[] } = {}): RideLog {
  const min = opts.min ?? 60;
  return {
    startedAt: now - daysBefore * DAY,
    durationSec: min * 60,
    tss: opts.tss ?? 50,
    zoneSec: opts.zoneSec ?? [0, min * 60, 0, 0, 0, 0, 0],
    challenges: opts.id ? [{ id: opts.id, passed: opts.passed ?? true }] : [],
  };
}

const tested = (rides: RideLog[]): CoachProfile => ({ ftp: 250, ftpHistory: [{ at: 0, ftp: 250 }], completed: {}, rides });

describe('training load', () => {
  it('estimates TSS from zone time for older rides', () => {
    // one hour in Z4 (~98% FTP) ≈ 96 TSS
    expect(rideTss({ startedAt: 0, durationSec: 3600, zoneSec: [0, 0, 0, 3600, 0, 0, 0], challenges: [] })).toBe(96);
    expect(rideTss({ startedAt: 0, durationSec: 3600, tss: 42, zoneSec: [], challenges: [] })).toBe(42);
  });

  it('builds fitness slowly and fatigue quickly; form goes negative while training', () => {
    const rides = Array.from({ length: 60 }, (_, i) => ride(WED, i + 1, { tss: 50 }));
    const l = trainingLoad(rides, WED);
    expect(l.fatigue).toBeGreaterThan(l.fitness);
    expect(l.form).toBeLessThan(0);
    expect(l.formLabel).toBe('Building');
    expect(l.weekTss).toBe(6 * 50);
    expect(l.todayTss).toBe(0);
  });

  it('a week off makes you fresh', () => {
    const rides = Array.from({ length: 28 }, (_, i) => ride(WED, i + 8, { tss: 80 }));
    expect(trainingLoad(rides, WED).formLabel).toBe('Fresh');
  });

  it('dayIndex follows the local calendar', () => {
    expect(dayIndex(new Date(2026, 10, 18, 0, 5).getTime())).toBe(dayIndex(new Date(2026, 10, 18, 23, 55).getTime()));
    expect(dayIndex(new Date(2026, 10, 19, 0, 5).getTime()) - dayIndex(new Date(2026, 10, 18, 23, 55).getTime())).toBe(1);
  });
});

describe('isHardRide', () => {
  it('counts hard workouts, challenges and long threshold time; not Zone 2', () => {
    expect(isHardRide(ride(WED, 1, { id: 'wk-vo2-5x3' }))).toBe(true);
    expect(isHardRide(ride(WED, 1, { id: 'tabata' }))).toBe(true);
    expect(isHardRide(ride(WED, 1, { id: 'wk-z2-60' }))).toBe(false);
    expect(isHardRide(ride(WED, 1, { zoneSec: [0, 1800, 0, 900, 0, 0, 0] }))).toBe(true);
    expect(isHardRide(ride(WED, 1))).toBe(false);
  });
});

describe('suggestToday', () => {
  it('asks an untested rider to take the ramp test', () => {
    const s = suggestToday({ ftp: 200, ftpHistory: [], completed: {}, rides: [] }, WED);
    expect(s.kind).toBe('test');
    expect(s.workout.id).toBe('ramp-test');
  });

  it('starts a new rider with easy Zone 2', () => {
    const s = suggestToday(tested([]), WED);
    expect(s.kind).toBe('endurance');
    expect(s.workout.id).toBe('wk-z2-45');
  });

  it('suggests rest after training today', () => {
    expect(suggestToday(tested([ride(WED, 0, { tss: 60 })]), WED).kind).toBe('rest');
  });

  it('suggests recovery when deeply fatigued', () => {
    const rides = Array.from({ length: 10 }, (_, i) => ride(WED, i + 1, { tss: 160 }));
    const s = suggestToday(tested(rides), WED);
    expect(s.kind).toBe('recovery');
    expect(s.workout.id).toBe('wk-recovery-30');
  });

  it('goes easy the day after a hard session', () => {
    const s = suggestToday(tested([ride(WED, 1, { id: 'wk-vo2-5x3' })]), WED);
    expect(s.kind).toBe('endurance');
    expect(s.workout.workout!.focus).toBe('Zone 2');
    expect(s.reason).toMatch(/yesterday/);
  });

  it('goes easy once the weekly intensity budget is used', () => {
    const rides = [ride(WED, 2, { id: 'wk-ss-3x10' }), ride(WED, 4, { id: 'wk-vo2-5x3' }), ride(WED, 6, { id: 'wk-thr-2x10' })];
    const s = suggestToday(tested(rides), WED);
    expect(s.kind).toBe('endurance');
    expect(s.reason).toMatch(/3 hard days/);
  });

  it('a new rider starts hard days with sweet spot', () => {
    expect(suggestToday(tested([ride(WED, 2, { id: 'wk-z2-60' })]), WED).workout.workout!.category).toBe('sweetspot');
  });

  it('picks the most overdue hard category, one rung up after a completion', () => {
    // sweet spot was 2 days ago (not due, spacing 4); threshold never → overdue
    const s = suggestToday(tested([ride(WED, 2, { id: 'wk-ss-3x10' })]), WED);
    expect(s.kind).toBe('hard');
    expect(s.workout.workout!.category).toBe('threshold');

    const s2 = suggestToday(tested([ride(WED, 9, { id: 'wk-thr-2x10' }), ride(WED, 6, { id: 'wk-ss-3x10' }), ride(WED, 3, { id: 'wk-vo2-4x3' })]), WED);
    expect(s2.workout.workout!.category).toBe('sweetspot');
    const prev = challengeById('wk-ss-3x10')!.workout!.rung;
    expect(s2.workout.workout!.rung).toBe(prev + 1);
    expect(s2.reason).toMatch(/One step up from Sweet Spot 3×10/);
  });

  it('repeats the same rung after ending a workout early', () => {
    const s = suggestToday(
      tested([ride(WED, 9, { id: 'wk-thr-2x10' }), ride(WED, 6, { id: 'wk-ss-3x10', passed: false }), ride(WED, 3, { id: 'wk-vo2-4x3' })]),
      WED,
    );
    expect(s.workout.id).toBe('wk-ss-3x10');
    expect(s.reason).toMatch(/ended it early/);
  });

  it('check-in: easy → two rungs up, hard → repeat; two early endings → one rung down', () => {
    const around = (last: RideLog[]) => tested([ride(WED, 9, { id: 'wk-thr-2x10' }), ...last, ride(WED, 3, { id: 'wk-vo2-4x3' })]);
    const base = challengeById('wk-ss-3x10')!.workout!.rung;
    const ssRide = (feel?: 'easy' | 'right' | 'hard', passed = true) => {
      const r = ride(WED, 6, { id: 'wk-ss-3x10', passed });
      r.challenges[0].feel = feel;
      return r;
    };
    expect(suggestToday(around([ssRide('easy')]), WED).workout.workout!.rung).toBe(base + 2);
    expect(suggestToday(around([ssRide('right')]), WED).workout.workout!.rung).toBe(base + 1);
    const hard = suggestToday(around([ssRide('hard')]), WED);
    expect(hard.workout.id).toBe('wk-ss-3x10');
    expect(hard.reason).toMatch(/felt hard/);
    const twice = suggestToday(around([ride(WED, 12, { id: 'wk-ss-3x10', passed: false }), ssRide(undefined, false)]), WED);
    expect(twice.workout.workout!.rung).toBe(base - 1);
    expect(twice.reason).toMatch(/tough twice/);
  });

  it('keeps weekday sessions within 75 minutes', () => {
    // top sweet spot rungs are ~90 min; progression from 3×15 must stay ≤ 75 min on a weekday
    const s = suggestToday(tested([ride(WED, 9, { id: 'wk-thr-2x10' }), ride(WED, 6, { id: 'wk-ss-3x15' }), ride(WED, 3, { id: 'wk-vo2-4x3' })]), WED);
    expect(s.workout.workout!.category).toBe('sweetspot');
    expect(s.workout.steps.reduce((a, x) => a + x.durationSec, 0)).toBeLessThanOrEqual(75 * 60);
  });

  it('suggests a long Zone 2 ride at the weekend if none this week', () => {
    const s = suggestToday(tested([ride(SAT, 3, { id: 'wk-ss-3x10' })]), SAT);
    expect(s.kind).toBe('endurance');
    expect(s.reason).toMatch(/Weekend/);
    expect(s.workout.steps.reduce((a, x) => a + x.durationSec, 0)).toBeGreaterThanOrEqual(60 * 60);
  });
});

describe('swapsFor', () => {
  it('moves one rung for easier/harder and picks a shorter session in the same category', () => {
    const ss = challengeById('wk-ss-3x10')!;
    const s = swapsFor(ss);
    expect(s.harder!.workout!.rung).toBe(ss.workout!.rung + 1);
    expect(s.easier!.workout!.rung).toBe(ss.workout!.rung - 1);
    expect(s.shorter!.workout!.category).toBe('sweetspot');
    expect(s.shorter!.steps.reduce((a, x) => a + x.durationSec, 0)).toBeLessThanOrEqual(49 * 60);
  });

  it('has no harder option at the top, and drops to Zone 2 below the bottom of a hard ladder', () => {
    expect(swapsFor(challengeById('wk-thr-2x20')!).harder).toBeNull();
    expect(swapsFor(challengeById('wk-vo2-5x2')!).easier!.id).toBe('wk-z2-45');
    expect(swapsFor(challengeById('wk-recovery-30')!).easier).toBeNull();
  });

  it('offers an easy ride instead of the ramp test', () => {
    expect(swapsFor(challengeById('ramp-test')!).easier!.id).toBe('wk-z2-45');
  });
});

describe('plans', () => {
  const plan = (goal: TrainingPlan['goal'], extra: Partial<TrainingPlan> = {}): TrainingPlan => ({
    goal,
    minutesByDay: [90, 0, 60, 45, 60, 0, 120], // Sun … Sat
    createdAt: new Date(2026, 10, 16, 9).getTime(), // block 1, week 1 is the test week
    ...extra,
  });
  const withPlan = (rides: RideLog[], p: TrainingPlan): CoachProfile => ({ ...tested(rides), plan: p });
  const MON = new Date(2026, 10, 16, 12).getTime();
  const minutesOf = (c: { steps: { durationSec: number }[] }) => c.steps.reduce((a, s) => a + s.durationSec, 0) / 60;

  it('weekday() and weekStart() use the local calendar, weeks starting Monday', () => {
    expect(weekday(dayIndex(WED))).toBe(3);
    expect(weekday(dayIndex(SAT))).toBe(6);
    expect(weekStart(dayIndex(SAT))).toBe(dayIndex(MON));
    expect(weekStart(dayIndex(MON))).toBe(dayIndex(MON));
  });

  it('rest days in the plan suggest rest', () => {
    const s = suggestToday(withPlan([ride(MON, 3, { id: 'wk-z2-60' })], plan('fitness')), MON);
    expect(s.kind).toBe('rest');
    expect(s.reason).toMatch(/rest day/);
  });

  it('fits sessions to the time available today', () => {
    // Wednesday has 45 minutes
    const s = suggestToday(withPlan([ride(WED, 9, { id: 'wk-thr-2x10' }), ride(WED, 6, { id: 'wk-ss-4x10' }), ride(WED, 3, { id: 'wk-vo2-4x3' })], plan('ftp')), WED);
    expect(minutesOf(s.workout)).toBeLessThanOrEqual(46);
    expect(s.reason).toMatch(/fits the 45 minutes/);
  });

  it('the goal decides which category comes first', () => {
    const rides = [ride(WED, 3, { id: 'wk-z2-60' })];
    expect(suggestToday(withPlan(rides, plan('base')), WED).workout.workout!.category).toBe('tempo');
    expect(suggestToday(withPlan(rides, plan('event', { eventDate: '2027-06-01' })), WED).workout.workout!.category).toBe('threshold');
    expect(suggestToday(withPlan(rides, plan('ftp')), WED).workout.workout!.category).toBe('sweetspot');
  });

  it('base goal allows one hard day a week', () => {
    expect(hardPerWeek(plan('base'))).toBe(1);
    const s = suggestToday(withPlan([ride(WED, 3, { id: 'wk-tempo-3x10' })], plan('base')), WED);
    expect(s.kind).toBe('endurance');
  });

  it('caps hard days at about every other riding day', () => {
    expect(hardPerWeek(plan('ftp', { minutesByDay: [60, 0, 0, 60, 0, 0, 0] }))).toBe(1);
    expect(hardPerWeek(plan('ftp'))).toBe(3);
  });

  it('long-ride day is the plan’s longest day', () => {
    const s = suggestToday(withPlan([ride(SAT, 3, { id: 'wk-ss-3x10' })], plan('fitness')), SAT);
    expect(s.kind).toBe('endurance');
    expect(s.reason).toMatch(/Long-ride day/);
    expect(s.workout.id).toBe('wk-z2-120');
  });

  it('event countdown: openers the day before, rest on the day, short sessions in taper week', () => {
    const ev = (d: number) => {
      const t = new Date(WED + d * DAY);
      return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    };
    const rides = [ride(WED, 3, { id: 'wk-z2-60' })];
    expect(suggestToday(withPlan(rides, plan('event', { eventDate: ev(0) })), WED).reason).toMatch(/event day/);
    expect(suggestToday(withPlan(rides, plan('event', { eventDate: ev(1) })), WED).workout.id).toBe('wk-sprint-6x10');
    const taper = suggestToday(withPlan(rides, plan('event', { eventDate: ev(5), minutesByDay: [90, 60, 90, 90, 90, 60, 120] })), WED);
    expect(taper.kind).toBe('hard');
    expect(minutesOf(taper.workout)).toBeLessThanOrEqual(46);
    expect(taper.reason).toMatch(/Taper week/);
  });

  it('weekly target and progress', () => {
    const p = plan('fitness');
    expect(weeklyTargetTss(p)).toBe(Math.round(((375 / 60) * 55) / 10) * 10);
    const w = weekProgress([ride(WED, 1, { tss: 60 }), ride(WED, 0, { tss: 40 })], p, WED);
    expect(w.tss).toBe(100);
    expect(w.days).toHaveLength(7);
    expect(w.days[0].weekday).toBe(1);
    expect(w.days.find((d) => d.isToday)!.tss).toBe(40);
  });

  it('streak counts consecutive weeks at 80% of target and survives an unfinished current week', () => {
    const p = plan('fitness'); // target 340
    const weekOf = (weeksBack: number, tss: number) => ride(MON, 7 * weeksBack - 2, { tss }); // Saturdays
    const rides = [weekOf(1, 300), weekOf(2, 280), weekOf(3, 100), weekOf(4, 400)];
    const w = weekProgress(rides, p, MON);
    expect(w.thisWeekDone).toBe(false);
    expect(w.streak).toBe(2);
    const done = weekProgress([...rides, ride(MON, 0, { tss: 300 })], p, MON);
    expect(done.thisWeekDone).toBe(true);
    expect(done.streak).toBe(3);
  });
});

describe('training blocks', () => {
  const MON = new Date(2026, 10, 16, 12).getTime();
  const everyDay: TrainingPlan['minutesByDay'] = [60, 60, 60, 60, 60, 60, 60];
  // Plan created mid-week three weeks ago: blocks are anchored to that week's Monday.
  const plan: TrainingPlan = { goal: 'fitness', minutesByDay: everyDay, createdAt: MON - 19 * DAY };
  const profile = (rides: RideLog[], promotions: CoachProfile['promotions'] = []): CoachProfile => ({ ...tested(rides), plan, promotions });

  it('numbers blocks and weeks from the Monday the plan started', () => {
    expect(blockInfo(plan, MON - 21 * DAY)).toMatchObject({ number: 1, week: 1, recovery: false, retestFor: null });
    expect(blockInfo(plan, MON)).toMatchObject({ number: 1, week: 4, recovery: true, retestFor: null });
    expect(blockInfo(plan, MON + 4 * DAY)).toMatchObject({ number: 1, week: 4, retestFor: 1 }); // Friday of week 4
    expect(blockInfo(plan, MON + 7 * DAY)).toMatchObject({ number: 2, week: 1, retestFor: 1 }); // grace days
    expect(blockInfo(plan, MON + 10 * DAY)).toMatchObject({ number: 2, week: 1, retestFor: null });
  });

  it('weekly target rises through the build weeks and drops in the recovery week', () => {
    const base = weeklyTargetTss(plan);
    expect(weekProgress([], plan, MON - 21 * DAY).target).toBe(base);
    expect(weekProgress([], plan, MON - 7 * DAY).target).toBe(Math.round((base * 1.15) / 10) * 10);
    expect(weekProgress([], plan, MON).target).toBe(Math.round((base * 0.65) / 10) * 10);
  });

  it('suggests the FTP retest in the retest window until promoted', () => {
    const rides = [ride(MON + 4 * DAY, 2, { id: 'wk-z2-60' })];
    const s = suggestToday(profile(rides), MON + 4 * DAY);
    expect(s.workout.id).toBe('ramp-test');
    expect(s.reason).toMatch(/Rank I\b/);
    const promoted = suggestToday(profile(rides, [{ planCreatedAt: plan.createdAt, block: 1, at: 0, oldFtp: 250, newFtp: 255 }]), MON + 4 * DAY);
    expect(promoted.workout.id).not.toBe('ramp-test');
  });

  it('recovery week allows one hard day and shortens sessions', () => {
    const wed = MON + 2 * DAY;
    const s = suggestToday(profile([ride(wed, 2, { id: 'wk-vo2-5x3' })]), wed);
    expect(s.kind).toBe('endurance');
    expect(s.reason).toMatch(/Recovery week/);
    expect(s.workout.steps.reduce((a, x) => a + x.durationSec, 0)).toBeLessThanOrEqual(45 * 60);
  });
});
