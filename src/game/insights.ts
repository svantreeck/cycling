import { challengeById, type WorkoutCategory } from './challenges';
import type { Feel, RideLog } from './coach';
import { median } from './rideMetrics';

/**
 * The coach's opinions: trends across several rides (never a single ride) in cadence, heart rate at a given power
 * and post-ride check-ins. Each one is compared with the rider's own history, so 85 rpm is normal for one rider and
 * slow for another.
 */

export type InsightId =
  | 'feel-hard'
  | 'tired-hr'
  | 'ftp-low'
  | 'cadence-grind'
  | 'cadence-fade'
  | 'cadence-drop'
  | 'aerobic-drift'
  | 'aerobic-up';

export interface Insight {
  id: InsightId;
  /** what the coach noticed */
  text: string;
  /** the same in a few words, to finish "…because ___" */
  brief: string;
  /** ftp-low: the FTP the coach would raise to without a retest */
  raiseFtpTo?: number;
}

export interface InsightInput {
  ftp: number;
  ftpHistory: { at: number; ftp: number }[];
  rides: RideLog[];
  /** fitness − fatigue, from trainingLoad */
  form: number;
  /** when the rider last said "not now" to the FTP suggestion */
  ftpNudgeDismissedAt?: number;
}

const DAY = 86_400_000;
/** how far back "recent" reaches */
const RECENT_DAYS = 21;
/** "Not now" on the FTP suggestion hides it for this long */
export const FTP_NUDGE_SNOOZE_DAYS = 7;
/** the rider counts as tired below this form; low heart rate then means fatigue, not fitness */
const TIRED_FORM = -20;

const HARD_CATEGORIES: WorkoutCategory[] = ['sweetspot', 'threshold', 'vo2max', 'tempo', 'anaerobic'];

/** A ride's check-in: the ride's own, or else the last workout check-in during it. */
export function rideFeel(r: RideLog): Feel | undefined {
  if (r.feel) return r.feel;
  for (let i = r.challenges.length - 1; i >= 0; i--) if (r.challenges[i].feel) return r.challenges[i].feel;
  return undefined;
}

const pct = (x: number) => `${Math.round(x)}%`;

export function coachInsights(input: InsightInput, now = Date.now()): Insight[] {
  const rides = input.rides.filter((r) => r.startedAt <= now).sort((a, b) => a.startedAt - b.startedAt);
  const recentCutoff = now - RECENT_DAYS * DAY;
  const out: Insight[] = [];

  // ---- check-ins: the last three rides all felt really hard
  const last3 = rides.slice(-3);
  // …recently: a few days off is the rest it was asking for
  const feelHard =
    last3.length === 3 && last3[0].startedAt >= now - 10 * DAY && last3[2].startedAt >= now - 3 * DAY && last3.every((r) => rideFeel(r) === 'hard');
  if (feelHard) {
    out.push({
      id: 'feel-hard',
      text: 'Your last three rides all felt really hard. Fatigue is building up faster than you recover from it.',
      brief: 'your last three rides all felt really hard',
    });
  }
  const rated = rides.filter((r) => rideFeel(r)).slice(-3);
  const tired = input.form < TIRED_FORM || rated.filter((r) => rideFeel(r) === 'hard').length >= 2;

  // ---- heart rate at Zone 2 power, since the FTP was last set (Zone 2 watts depend on it)
  const ftpSetAt = input.ftpHistory.length ? input.ftpHistory[input.ftpHistory.length - 1].at : 0;
  const aerobic = rides.filter((r) => r.startedAt > ftpSetAt && r.metrics?.aerobic);
  const recentAer = aerobic.filter((r) => r.startedAt >= recentCutoff).slice(-3);
  const baseAer = aerobic.filter((r) => r.startedAt < recentCutoff).slice(0, 5);
  let hrDrop: { watts: number; then: number; now: number; gain: number } | null = null;
  if (recentAer.length >= 3 && baseAer.length >= 3) {
    const ef = (rs: RideLog[]) => median(rs.map((r) => r.metrics!.aerobic!.watts / r.metrics!.aerobic!.hr));
    const efBase = ef(baseAer);
    const efNow = ef(recentAer);
    const watts = Math.round(median(baseAer.map((r) => r.metrics!.aerobic!.watts)) / 5) * 5;
    hrDrop = { watts, then: Math.round(watts / efBase), now: Math.round(watts / efNow), gain: efNow / efBase - 1 };
  }

  // ---- interval workouts keep feeling easy, since the FTP was last set
  const intervals = rides
    .filter((r) => r.startedAt > ftpSetAt)
    .flatMap((r) => r.challenges)
    .filter((c) => {
      const cat = challengeById(c.id)?.workout?.category;
      return c.passed && c.feel && cat && HARD_CATEGORIES.includes(cat);
    })
    .slice(-3);
  const intervalsEasy = intervals.length === 3 && intervals.filter((c) => c.feel === 'easy').length >= 2 && !intervals.some((c) => c.feel === 'hard');

  const hrLower = hrDrop != null && hrDrop.gain >= 0.05 && hrDrop.then - hrDrop.now >= 3;
  const snoozed = input.ftpNudgeDismissedAt != null && now - input.ftpNudgeDismissedAt < FTP_NUDGE_SNOOZE_DAYS * DAY;
  if (hrLower && tired) {
    out.push({
      id: 'tired-hr',
      text: `Your heart rate at ${hrDrop!.watts} W is lower than it was (${hrDrop!.now} bpm, down from ${hrDrop!.then}), but you're also tired. Fatigue can hold your heart rate down, so this may be tiredness rather than new fitness.`,
      brief: "you're tired, and fatigue is holding your heart rate down",
    });
  } else if ((hrLower || intervalsEasy) && !tired && !snoozed) {
    const both = hrLower && intervalsEasy;
    const raise = Math.round(input.ftp * (both ? 1.03 : 1.02));
    const evidence = [
      hrLower ? `at ${hrDrop!.watts} W your heart rate has dropped from ${hrDrop!.then} to ${hrDrop!.now} bpm since your FTP was set` : null,
      intervalsEasy ? 'your interval workouts keep feeling easy' : null,
    ].filter(Boolean);
    out.push({
      id: 'ftp-low',
      text: `You've got fitter: ${evidence.join(', and ')}. Your FTP is probably higher than ${input.ftp} W, so your workouts are too easy.`,
      brief: hrLower ? 'your heart rate is lower for the same watts' : 'your interval workouts keep feeling easy',
      raiseFtpTo: raise,
    });
  } else if (hrDrop && hrDrop.gain >= 0.025 && hrDrop.then > hrDrop.now) {
    out.push({
      id: 'aerobic-up',
      text: `Your aerobic engine is growing: at ${hrDrop.watts} W your heart rate is down from ${hrDrop.then} to ${hrDrop.now} bpm. Keep the Zone 2 rides coming.`,
      brief: 'your heart rate is dropping for the same watts',
    });
  }

  // ---- cadence, against the rider's own normal
  const withCad = rides.filter((r) => r.metrics?.cadence);
  const easyCad = withCad.filter((r) => r.metrics!.cadence!.easy != null);
  const spunUpLately = rides.some((r) => r.startedAt >= now - 7 * DAY && r.challenges.some((c) => c.id === 'wk-z2-cadence'));
  if (easyCad.length >= 5 && !spunUpLately) {
    const normal = Math.round(median(easyCad.slice(-20).map((r) => r.metrics!.cadence!.easy!)));
    const recent = (key: 'hard' | 'late') => withCad.filter((r) => r.startedAt >= recentCutoff && r.metrics!.cadence![key] != null).slice(-3);
    const hard = recent('hard');
    const grinding = hard.filter((r) => r.metrics!.cadence!.hard! <= normal - 8);
    const faded = recent('late').filter((r) => r.metrics!.cadence!.late! <= r.metrics!.cadence!.early! - 6);
    const baseEasy = easyCad.filter((r) => r.startedAt < recentCutoff).slice(-10);
    const nowEasy = easyCad.filter((r) => r.startedAt >= recentCutoff).slice(-3);
    const was = baseEasy.length >= 5 ? Math.round(median(baseEasy.map((r) => r.metrics!.cadence!.easy!))) : null;
    const is = nowEasy.length >= 3 ? Math.round(median(nowEasy.map((r) => r.metrics!.cadence!.easy!))) : null;

    if (hard.length >= 2 && grinding.length >= 2) {
      const at = Math.round(median(grinding.map((r) => r.metrics!.cadence!.hard!)));
      out.push({
        id: 'cadence-grind',
        text: `On hard efforts your cadence drops to about ${at} rpm, well below your usual ${normal}. Grinding a big gear tires your legs faster. When the watts go up, shift to an easier gear and keep spinning near ${normal}.`,
        brief: 'your cadence drops on hard efforts',
      });
    } else if (faded.length >= 2) {
      const early = Math.round(median(faded.map((r) => r.metrics!.cadence!.early!)));
      const late = Math.round(median(faded.map((r) => r.metrics!.cadence!.late!)));
      out.push({
        id: 'cadence-fade',
        text: `Late in your rides your cadence fades from about ${early} to ${late} rpm. That's tiring legs losing their form. Spin-up drills help you hold a smooth stroke for longer.`,
        brief: 'your cadence fades late in rides',
      });
    } else if (was != null && is != null && is <= was - 5) {
      out.push({
        id: 'cadence-drop',
        text: `Your easy-ride cadence has slipped from about ${was} to ${is} rpm over the last few weeks. Spinning a bit faster in Zone 2 saves your legs for the hard days.`,
        brief: 'your cadence has been slipping',
      });
    }
  }

  // ---- heart rate drifting up on long Zone 2 rides
  const drifts = aerobic.filter((r) => r.metrics!.aerobic!.drift != null && r.startedAt >= now - 30 * DAY).slice(-2);
  if (drifts.length === 2 && drifts.every((r) => r.metrics!.aerobic!.drift! > 5)) {
    const d = median(drifts.map((r) => r.metrics!.aerobic!.drift!));
    out.push({
      id: 'aerobic-drift',
      text: `On your long Zone 2 rides your heart rate drifts up about ${pct(d)} in the second half at the same watts. More long, steady rides will bring that down. Drinking enough helps too.`,
      brief: 'your heart rate drifts up on long rides',
    });
  }

  return out;
}

export const isCadenceInsight = (i: Insight) => i.id.startsWith('cadence-');
