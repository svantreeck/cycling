import { challengeById } from './challenges';
import { dayIndex, isHardRide, rideTss, suggestToday, swapsFor, trainingLoad, type CoachProfile, type RideLog } from './coach';

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
