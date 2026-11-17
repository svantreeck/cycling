import type { Feel, RideLog } from './coach';
import { coachInsights, FTP_NUDGE_SNOOZE_DAYS, rideFeel, type InsightInput } from './insights';
import type { RideMetrics } from './rideMetrics';

const NOW = new Date(2026, 10, 18, 12).getTime();
const DAY = 86_400_000;

function ride(daysBefore: number, opts: { metrics?: RideMetrics; feel?: Feel; id?: string; workoutFeel?: Feel } = {}): RideLog {
  return {
    startedAt: NOW - daysBefore * DAY,
    durationSec: 3600,
    tss: 50,
    zoneSec: [0, 3600, 0, 0, 0, 0, 0],
    challenges: opts.id ? [{ id: opts.id, passed: true, feel: opts.workoutFeel }] : [],
    feel: opts.feel,
    metrics: opts.metrics,
  };
}

const input = (rides: RideLog[], extra: Partial<InsightInput> = {}): InsightInput => ({
  ftp: 250,
  ftpHistory: [{ at: NOW - 70 * DAY, ftp: 250 }],
  rides,
  form: 0,
  ...extra,
});

const ids = (i: InsightInput) => coachInsights(i, NOW).map((x) => x.id);
const aer = (hr: number, watts = 170): RideMetrics => ({ aerobic: { sec: 1800, watts, hr } });
/** Zone 2 rides: four 4–7 weeks ago at `then` bpm, three in the last week at `now` bpm, all at 170 W. */
const hrTrend = (then: number, now: number) => [
  ...[49, 42, 35, 28].map((d) => ride(d, { metrics: aer(then) })),
  ...[6, 4, 2].map((d) => ride(d, { metrics: aer(now) })),
];

describe('check-in trends', () => {
  it("uses the ride's own check-in, else its workout's", () => {
    expect(rideFeel(ride(0, { feel: 'hard' }))).toBe('hard');
    expect(rideFeel(ride(0, { id: 'wk-z2-60', workoutFeel: 'easy' }))).toBe('easy');
    expect(rideFeel(ride(0))).toBeUndefined();
  });

  it('notices when the last three rides all felt really hard', () => {
    expect(ids(input([ride(5, { feel: 'hard' }), ride(3, { feel: 'hard' }), ride(1, { feel: 'hard' })]))).toContain('feel-hard');
  });

  it('a single hard ride, or an easier ride since, is not a trend', () => {
    expect(ids(input([ride(1, { feel: 'hard' })]))).not.toContain('feel-hard');
    expect(ids(input([ride(5, { feel: 'hard' }), ride(3, { feel: 'hard' }), ride(1, { feel: 'right' })]))).not.toContain('feel-hard');
  });
});

describe('heart rate at the same power', () => {
  it('suggests the FTP is low when Zone 2 heart rate has dropped', () => {
    const [i] = coachInsights(input(hrTrend(120, 112)), NOW);
    expect(i.id).toBe('ftp-low');
    expect(i.text).toContain('from 120 to 112 bpm');
    expect(i.raiseFtpTo).toBe(255); // +2%
  });

  it('a single low-heart-rate ride is not a trend', () => {
    const rides = [...[49, 42, 35, 28, 6, 4].map((d) => ride(d, { metrics: aer(120) })), ride(2, { metrics: aer(105) })];
    expect(ids(input(rides))).not.toContain('ftp-low');
  });

  it('only compares rides since the FTP was last set', () => {
    expect(ids(input(hrTrend(120, 112), { ftpHistory: [{ at: NOW - 10 * DAY, ftp: 250 }] }))).not.toContain('ftp-low');
  });

  it('reads low heart rate as fatigue when the rider is tired', () => {
    const got = ids(input(hrTrend(120, 112), { form: -25 }));
    expect(got).toContain('tired-hr');
    expect(got).not.toContain('ftp-low');
  });

  it('praises a smaller improvement without suggesting a new FTP', () => {
    expect(ids(input(hrTrend(120, 116)))).toEqual(['aerobic-up']);
  });

  it('"Not now" snoozes the FTP suggestion for a week', () => {
    expect(ids(input(hrTrend(120, 112), { ftpNudgeDismissedAt: NOW - 2 * DAY }))).not.toContain('ftp-low');
    expect(ids(input(hrTrend(120, 112), { ftpNudgeDismissedAt: NOW - (FTP_NUDGE_SNOOZE_DAYS + 1) * DAY }))).toContain('ftp-low');
  });

  it('interval workouts that keep feeling easy also suggest a low FTP, more so with heart rate', () => {
    const easy = [9, 7, 5].map((d) => ride(d, { id: 'wk-ss-2x10', workoutFeel: 'easy' }));
    expect(coachInsights(input(easy), NOW).find((x) => x.id === 'ftp-low')?.raiseFtpTo).toBe(255);
    expect(coachInsights(input([...hrTrend(120, 112), ...easy]), NOW).find((x) => x.id === 'ftp-low')?.raiseFtpTo).toBe(258); // +3%
  });

  it('notices heart rate drifting up on long rides', () => {
    const drift = (d: number) => ride(d, { metrics: { aerobic: { sec: 3000, watts: 170, hr: 125, drift: 7 } } });
    expect(ids(input([drift(8), drift(2)]))).toContain('aerobic-drift');
    expect(ids(input([drift(2)]))).not.toContain('aerobic-drift');
  });
});

describe('cadence against the rider’s own normal', () => {
  const cad = (c: RideMetrics['cadence']): RideMetrics => ({ cadence: c });
  const normal = (rpm: number) => [40, 35, 30, 26, 23].map((d) => ride(d, { metrics: cad({ easy: rpm }) }));

  it('flags grinding on hard efforts relative to the rider’s normal', () => {
    const rides = [...normal(90), ...[5, 3].map((d) => ride(d, { metrics: cad({ easy: 90, hard: 80 }) }))];
    const i = coachInsights(input(rides), NOW).find((x) => x.id === 'cadence-grind');
    expect(i?.text).toContain('usual 90');
  });

  it('the same cadence is fine for a rider whose normal is lower', () => {
    const rides = [...normal(84), ...[5, 3].map((d) => ride(d, { metrics: cad({ easy: 84, hard: 80 }) }))];
    expect(ids(input(rides))).not.toContain('cadence-grind');
  });

  it('flags cadence fading late in rides', () => {
    const rides = [...normal(88), ...[5, 3].map((d) => ride(d, { metrics: cad({ easy: 88, early: 89, late: 81 }) }))];
    expect(ids(input(rides))).toContain('cadence-fade');
  });

  it('flags easy-ride cadence slipping over weeks', () => {
    const rides = [...normal(90), ...[6, 4, 2].map((d) => ride(d, { metrics: cad({ easy: 83 }) }))];
    expect(ids(input(rides))).toContain('cadence-drop');
  });

  it('stays quiet for a week after a spin-ups workout', () => {
    const rides = [...normal(90), ...[5, 3].map((d) => ride(d, { metrics: cad({ easy: 90, hard: 80 }) })), ride(1, { id: 'wk-z2-cadence' })];
    expect(ids(input(rides))).not.toContain('cadence-grind');
  });
});
