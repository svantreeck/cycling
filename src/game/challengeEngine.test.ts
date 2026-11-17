import type { TrainerSample } from '../ble/trainer';
import { ChallengeRun, type TrainerCommand } from './challengeEngine';
import { RAMP_TEST, WORKOUTS, challengeById, dailyBounty, mainSetStress, totalDurationSec, trainingStress, type Challenge } from './challenges';

const FTP = 200;

/** Feed the run 1 Hz samples from `fn(elapsedSec, run)` until it's done or maxSec passes. */
function ride(
  run: ChallengeRun,
  fn: (sec: number, run: ChallengeRun) => Partial<TrainerSample>,
  maxSec = 7200,
) {
  const cmds: TrainerCommand[] = [...run.start()];
  for (let sec = 0; sec <= maxSec && !run.done; sec++) {
    const s = { t: sec * 1000, power: 0, cadence: 90, speedKph: 30, ...fn(sec, run) };
    cmds.push(...run.update(s));
  }
  return cmds;
}

/** Rider who holds whatever the trainer asks (ERG) at 90 rpm. */
const obedient = (_: number, run: ChallengeRun) => ({ power: run.snapshot().targetWatts ?? 0, cadence: 90 });

const simple: Challenge = {
  id: 'test',
  name: 'Test',
  description: '',
  tier: 1,
  minLevel: 1,
  xpReward: 100,
  repeatable: true,
  steps: [
    { label: 'wu', kind: 'warmup', durationSec: 10, mode: 'erg', targetPctFtp: 50 },
    { label: 'w1', kind: 'work', durationSec: 10, mode: 'erg', targetPctFtp: 120 },
    { label: 'r1', kind: 'rest', durationSec: 10, mode: 'erg', targetPctFtp: 50 },
    { label: 'w2', kind: 'work', durationSec: 10, mode: 'erg', targetPctFtp: 120 },
    { label: 'cd', kind: 'cooldown', durationSec: 10, mode: 'erg', targetPctFtp: 40 },
  ],
  success: { kind: 'completeAll' },
};

describe('ChallengeRun: completeAll (ERG)', () => {
  it('passes when every interval is completed and emits ERG targets per step', () => {
    const run = new ChallengeRun(simple, FTP);
    const cmds = ride(run, obedient);
    const s = run.snapshot();
    expect(s.result?.passed).toBe(true);
    expect(s.status).toBe('done');
    const ergWatts = cmds.filter((c) => c.type === 'erg').map((c) => (c as { watts: number }).watts);
    expect(ergWatts).toEqual([100, 240, 100, 240, 80]);
    expect(cmds[cmds.length - 1]).toEqual({ type: 'free' });
  });

  it('fails when cadence drops below 60 rpm for 5 s in a work step', () => {
    const run = new ChallengeRun(simple, FTP);
    ride(run, (sec, r) => ({ ...obedient(sec, r), cadence: sec >= 12 ? 40 : 90 }));
    const s = run.snapshot();
    expect(s.result?.passed).toBe(false);
    expect(s.result?.reason).toMatch(/cracked/);
    expect(s.status).toBe('done');
  });

  it('a short cadence dip does not crack', () => {
    const run = new ChallengeRun(simple, FTP);
    ride(run, (sec, r) => ({ ...obedient(sec, r), cadence: sec >= 12 && sec < 15 ? 40 : 90 }));
    expect(run.snapshot().result?.passed).toBe(true);
  });

  it('abort before completion is a fail; abort during cooldown keeps the pass', () => {
    const a = new ChallengeRun(simple, FTP);
    ride(a, obedient, 15);
    a.abort();
    expect(a.snapshot().result).toMatchObject({ passed: false, aborted: true });

    const b = new ChallengeRun(simple, FTP);
    ride(b, obedient, 42);
    expect(b.snapshot().status).toBe('cooldown');
    expect(b.abort()).toEqual([{ type: 'free' }]);
    expect(b.snapshot().result?.passed).toBe(true);
  });

  it('handles big sample gaps (time warp) without skipping step commands', () => {
    const run = new ChallengeRun(simple, FTP);
    run.start();
    run.update({ t: 0, power: 100, cadence: 90, speedKph: 0 });
    const cmds = run.update({ t: 5000, power: 100, cadence: 90, speedKph: 0 });
    expect(cmds).toEqual([]);
    const cmds2 = run.update({ t: 10000, power: 100, cadence: 90, speedKph: 0 });
    expect(cmds2).toEqual([{ type: 'erg', watts: 240 }]);
  });
});

describe('ChallengeRun: bestAvg (free effort)', () => {
  const sprint = challengeById('first-sprint')!; // 10 s ≥ 150% FTP = 300 W

  it('passes as soon as the window average beats the target, then skips to cooldown', () => {
    const run = new ChallengeRun(sprint, FTP);
    const warmupSec = 300;
    const cmds: TrainerCommand[] = [];
    ride(run, (sec) => {
      if (sec < warmupSec) return { power: 110 };
      return { power: sec < warmupSec + 20 ? 320 : 150 };
    }, warmupSec + 15);
    const s = run.snapshot();
    expect(s.result?.passed).toBe(true);
    expect(s.status).toBe('cooldown');
    expect(s.step.kind).toBe('cooldown');
    void cmds;
  });

  it('switches the trainer to free-ride for the effort step', () => {
    const run = new ChallengeRun(sprint, FTP);
    const cmds = ride(run, () => ({ power: 110 }), 301);
    expect(cmds).toContainEqual({ type: 'free' });
  });

  it('fails if the peak is never reached', () => {
    const run = new ChallengeRun(sprint, FTP);
    ride(run, () => ({ power: 250 }));
    const r = run.snapshot().result!;
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/250 W/);
  });
});

describe('ChallengeRun: cadence', () => {
  it('passes after holding the rpm, tolerating a brief dip', () => {
    const run = new ChallengeRun(challengeById('spin-up')!, FTP);
    ride(run, (sec) => ({ power: 120, cadence: sec >= 300 ? (sec === 320 ? 95 : 105) : 85 }), 370);
    expect(run.snapshot().result?.passed).toBe(true);
  });
});

describe('ChallengeRun: ramp test', () => {
  it('computes FTP as 75% of best minute when the rider cracks', () => {
    const run = new ChallengeRun(RAMP_TEST, FTP);
    // Rider holds ERG until target exceeds 320 W, then cadence collapses.
    ride(run, (_sec, r) => {
      const target = r.snapshot().targetWatts ?? 0;
      return target > 320 ? { power: 150, cadence: 30 } : { power: target, cadence: 90 };
    });
    const res = run.snapshot().result!;
    // Steps: 100,112,...; last held step ≤ 320 is 316 W (50+6*18 = 158% → 316 W).
    expect(res.bestMinutePower).toBe(316);
    expect(res.newFtp).toBe(237);
    expect(res.passed).toBe(true);
    expect(run.snapshot().status).not.toBe('running');
  });

  it("'I'm done' ends the ramp into cooldown with ERG cooldown target", () => {
    const run = new ChallengeRun(RAMP_TEST, FTP);
    ride(run, obedient, 180 + 60 * 5);
    const cmds = run.abort();
    expect(cmds).toEqual([{ type: 'erg', watts: 90 }]);
    expect(run.snapshot().status).toBe('cooldown');
    expect(run.snapshot().result?.newFtp).toBeGreaterThan(0);
  });
});

describe('promotion challenges', () => {
  it('scale with gate level', () => {
    const p5 = challengeById('promo-5')!;
    const p20 = challengeById('promo-20')!;
    expect(p5.promotionFor).toBe(5);
    const work = (c: Challenge) => c.steps.filter((s) => s.kind === 'work');
    expect(work(p20).length).toBeGreaterThan(work(p5).length);
    expect(work(p20)[0].targetPctFtp!).toBeGreaterThan(work(p5)[0].targetPctFtp!);
  });
});

describe('workouts', () => {
  const wk: Challenge = { ...simple, id: 'wk', workout: { category: 'endurance', focus: 'Zone 2', trains: ['endurance'], tss: 10, rung: 1, rungs: 1 } };

  it('never cracks: stopping pedalling pauses the clock, and the workout resumes after', () => {
    const run = new ChallengeRun(wk, FTP);
    // stop for 60 s in the middle of the first work step
    ride(run, (sec, r) => ({ ...obedient(sec, r), cadence: sec >= 12 && sec < 72 ? 0 : 90 }));
    const s = run.snapshot();
    expect(s.result?.passed).toBe(true);
    expect(s.totalElapsedSec).toBeCloseTo(50, 0);
  });

  it('reports paused in the snapshot and does not advance', () => {
    const run = new ChallengeRun(wk, FTP);
    run.start();
    run.update({ t: 0, power: 100, cadence: 90, speedKph: 30 });
    run.update({ t: 3000, power: 100, cadence: 90, speedKph: 30 });
    run.update({ t: 6000, power: 0, cadence: 0, speedKph: 0 });
    expect(run.snapshot()).toMatchObject({ paused: true, stepElapsedSec: 3 });
    run.update({ t: 7000, power: 100, cadence: 85, speedKph: 30 });
    expect(run.snapshot()).toMatchObject({ paused: false, stepElapsedSec: 4 });
  });

  it('ending early is an abort, not a failure', () => {
    const run = new ChallengeRun(wk, FTP);
    ride(run, obedient, 15);
    run.abort();
    expect(run.snapshot().result).toMatchObject({ passed: false, aborted: true, reason: 'Workout ended early.' });
  });

  it('progress is time-based', () => {
    const run = new ChallengeRun(wk, FTP);
    ride(run, obedient, 25);
    expect(run.snapshot().ruleProgress).toBeCloseTo(0.5, 1);
  });

  it('catalog: unique ids, warm-up first, cool-down last, every step has a target, sensible TSS', () => {
    const ids = new Set(WORKOUTS.map((w) => w.id));
    expect(ids.size).toBe(WORKOUTS.length);
    for (const w of WORKOUTS) {
      expect(challengeById(w.id)).toBe(w);
      expect(w.steps.every((s) => s.targetPctFtp != null)).toBe(true);
      // Only sprints use free resistance, and only for the sprint itself.
      const free = w.steps.filter((s) => s.mode === 'free');
      if (w.workout!.category === 'sprint') expect(free.every((s) => s.kind === 'effort')).toBe(true);
      else expect(free).toEqual([]);
      expect(w.steps[0].kind).toBe('warmup');
      expect(w.steps[w.steps.length - 1].kind).toBe('cooldown');
      expect(w.workout!.tss).toBe(trainingStress(w.steps));
      expect(w.workout!.tss).toBeGreaterThan(5);
      expect(w.workout!.tss).toBeLessThan(150);
    }
  });

  it('catalog: work in each category stays in its power zone', () => {
    const band: Partial<Record<string, [number, number]>> = {
      tempo: [76, 90],
      sweetspot: [88, 94],
      threshold: [95, 105],
      vo2max: [106, 120],
      anaerobic: [121, 200],
    };
    for (const w of WORKOUTS) {
      const work = w.steps.filter((s) => s.kind === 'work');
      const b = w.workout!.focus === 'Zone 2' ? [56, 75] : band[w.workout!.category];
      if (!b) continue;
      for (const s of work) {
        expect(s.targetPctFtp, `${w.id} ${s.label}`).toBeGreaterThanOrEqual(b[0]);
        expect(s.targetPctFtp, `${w.id} ${s.label}`).toBeLessThanOrEqual(b[1]);
      }
    }
  });

  it('catalog: every category is a ladder of 3+ rungs ordered by main-set stress, with a ≤35-min option', () => {
    const cats = new Set(WORKOUTS.map((w) => w.workout!.category));
    expect([...cats].sort()).toEqual(['anaerobic', 'endurance', 'sprint', 'sweetspot', 'tempo', 'threshold', 'vo2max']);
    for (const cat of cats) {
      const ladder = WORKOUTS.filter((w) => w.workout!.category === cat).sort((a, b) => a.workout!.rung - b.workout!.rung);
      expect(ladder.length, cat).toBeGreaterThanOrEqual(3);
      expect(ladder.map((w) => w.workout!.rung)).toEqual(ladder.map((_, i) => i + 1));
      expect(ladder.every((w) => w.workout!.rungs === ladder.length)).toBe(true);
      for (let i = 1; i < ladder.length; i++) expect(mainSetStress(ladder[i].steps)).toBeGreaterThanOrEqual(mainSetStress(ladder[i - 1].steps));
      expect(ladder.some((w) => totalDurationSec(w) <= 35 * 60), `${cat} short option`).toBe(true);
    }
  });

  it('catalog: every fitness system is trained, and sweet spot counts for tempo and threshold', () => {
    const trained = new Set(WORKOUTS.flatMap((w) => w.workout!.trains));
    expect([...trained].sort()).toEqual(['anaerobic', 'endurance', 'tempo', 'threshold', 'vo2max']);
    for (const w of WORKOUTS.filter((w) => w.workout!.category === 'sweetspot')) expect(w.workout!.trains).toEqual(['tempo', 'threshold']);
  });

  it('sprint workouts release the trainer for each sprint and complete', () => {
    const run = new ChallengeRun(challengeById('wk-sprint-6x10')!, FTP);
    const cmds = ride(run, (_, r) => ({ power: r.snapshot().targetWatts ?? 600, cadence: 100 }));
    expect(run.snapshot().result?.passed).toBe(true);
    expect(cmds.filter((c) => c.type === 'free').length).toBeGreaterThanOrEqual(6);
  });

  it('trainingStress: one hour at FTP is 100', () => {
    expect(trainingStress([{ label: '', kind: 'work', durationSec: 3600, mode: 'erg', targetPctFtp: 100 }])).toBe(100);
  });

  it('workouts are not in the daily bounty pool', () => {
    for (let d = 1; d <= 60; d++) expect(dailyBounty(30, new Date(2026, 0, d))?.workout).toBeUndefined();
  });
});
