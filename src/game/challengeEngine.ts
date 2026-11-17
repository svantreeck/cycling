import type { TrainerSample } from '../ble/trainer';
import { fmtDur, type Challenge, type Step } from './challenges';

export type TrainerCommand = { type: 'erg'; watts: number } | { type: 'free' };

export type RunStatus = 'running' | 'cooldown' | 'done';

export interface RunResult {
  passed: boolean;
  aborted: boolean;
  reason: string;
  /** best average power over the rule window (bestAvg) */
  bestAvgPower?: number;
  /** ramp test outputs */
  bestMinutePower?: number;
  newFtp?: number;
  rampStepsCompleted?: number;
}

export interface RunSnapshot {
  challengeId: string;
  status: RunStatus;
  stepIndex: number;
  step: Step;
  stepElapsedSec: number;
  stepRemainingSec: number;
  totalElapsedSec: number;
  targetWatts: number | null;
  /** 0..1 progress towards meeting the success rule */
  ruleProgress: number;
  ruleLabel: string;
  /** seconds cadence has been below the crack threshold */
  crackSec: number;
  /** workouts only: the clock is stopped (rider stopped pedalling, or paused it) */
  paused: boolean;
  /** workouts only: the rider paused it from a controller or the screen */
  manualPause: boolean;
  /** workouts only: rider adjustments to ERG targets */
  intensityPct: number;
  offsetW: number;
  result: RunResult | null;
}

/** Below this cadence in an ERG work step for CRACK_SEC, the rider has "cracked". */
export const CRACK_CADENCE = 60;
export const RAMP_CRACK_CADENCE = 50;
export const CRACK_SEC = 5;
/** Workouts pause their clock below this cadence (rider stopped for a drink, etc.). */
export const PAUSE_CADENCE = 20;
/** Ignore gaps longer than this (e.g. Bluetooth hiccup) when integrating time. */
const MAX_DT_MS = 5000;

interface Pt {
  t: number;
  power: number;
  dt: number;
}

/**
 * Runs a challenge against a stream of trainer samples.
 * Contains no React or Bluetooth code: feed it samples, and it returns trainer commands.
 */
export class ChallengeRun {
  /** set by the store: the workout id earning today's bonus when this run started */
  bonusId: string | undefined;
  readonly challenge: Challenge;
  readonly ftp: number;

  private stepIndex = 0;
  private stepElapsedMs = 0;
  private totalElapsedMs = 0;
  private lastT: number | null = null;
  private lowCadenceMs = 0;
  private status: RunStatus = 'running';
  private result: RunResult | null = null;
  private pts: Pt[] = [];
  private bestAvg = 0;
  private cadenceStreakMs = 0;
  private cadenceGraceMs = 0;
  private rampStepsCompleted = 0;
  private needCommand = true;
  private paused = false;
  private manualPause = false;
  /** workout targets scale (harder/easier) and watt nudge (shifting in ERG) */
  private intensityPct = 100;
  private offsetW = 0;

  constructor(challenge: Challenge, ftp: number) {
    this.challenge = challenge;
    this.ftp = ftp;
  }

  get done() {
    return this.status === 'done';
  }

  get currentStep(): Step {
    return this.challenge.steps[Math.min(this.stepIndex, this.challenge.steps.length - 1)];
  }

  /** Commands to apply right now (e.g. at start or after reconnect). */
  currentCommand(): TrainerCommand {
    const s = this.currentStep;
    if (this.status === 'done') return { type: 'free' };
    if (this.manualPause) return { type: 'free' };
    if (s.mode === 'erg' && s.targetPctFtp != null) return { type: 'erg', watts: this.targetWatts(s.targetPctFtp) };
    return { type: 'free' };
  }

  // ---- rider controls (workouts only; challenges are tests and stay fixed) --------------------------

  get adjustable() {
    return !!this.challenge.workout && this.status !== 'done';
  }

  /** Harder/easier: scale ERG targets in 5% steps (50–150%). */
  adjustIntensity(deltaPct: number): TrainerCommand[] {
    if (!this.adjustable) return [];
    this.intensityPct = Math.min(150, Math.max(50, this.intensityPct + deltaPct));
    return this.ergRefresh();
  }

  /** Shifting in ERG: nudge targets by a few watts. */
  nudgeWatts(deltaW: number): TrainerCommand[] {
    if (!this.adjustable) return [];
    this.offsetW = Math.max(-100, Math.min(100, this.offsetW + deltaW));
    return this.ergRefresh();
  }

  /** Jump to the next step. */
  skip(): TrainerCommand[] {
    if (!this.adjustable) return [];
    const finished = this.currentStep;
    this.stepElapsedMs = 0;
    this.lowCadenceMs = 0;
    this.onStepFinished(finished);
    this.stepIndex += 1;
    if (this.stepIndex >= this.challenge.steps.length) {
      this.stepIndex = this.challenge.steps.length - 1;
      this.finishNaturally();
      return [{ type: 'free' }];
    }
    return [this.currentCommand()];
  }

  /** Pause/resume the workout clock. While paused the trainer is released so the rider can soft-pedal. */
  setPaused(on: boolean): TrainerCommand[] {
    if (!this.adjustable || this.manualPause === on) return [];
    this.manualPause = on;
    this.paused = on;
    return [this.currentCommand()];
  }

  /** True while the current step is under ERG control (so shifting should nudge watts, not change gear). */
  get ergActive() {
    const s = this.currentStep;
    return this.status !== 'done' && !this.manualPause && s.mode === 'erg' && s.targetPctFtp != null;
  }

  private ergRefresh(): TrainerCommand[] {
    return this.ergActive ? [this.currentCommand()] : [];
  }

  /** Call after a reconnect: forget the sample clock (so the gap isn't counted) and re-send the target. */
  resume(): TrainerCommand[] {
    this.lastT = null;
    this.lowCadenceMs = 0;
    this.needCommand = false;
    return [this.currentCommand()];
  }

  start(): TrainerCommand[] {
    this.needCommand = false;
    return [this.currentCommand()];
  }

  update(sample: TrainerSample): TrainerCommand[] {
    if (this.status === 'done') return [];
    const cmds: TrainerCommand[] = [];
    if (this.needCommand) {
      this.needCommand = false;
      cmds.push(this.currentCommand());
    }
    if (this.lastT == null) {
      this.lastT = sample.t;
      return cmds;
    }
    const dt = Math.min(Math.max(0, sample.t - this.lastT), MAX_DT_MS);
    this.lastT = sample.t;
    if (dt === 0) return cmds;

    // Workouts can't be failed: stopping pedalling (or pausing) just stops the clock.
    this.paused = !!this.challenge.workout && (this.manualPause || sample.cadence < PAUSE_CADENCE);
    if (this.paused) return cmds;

    const step = this.currentStep;
    this.stepElapsedMs += dt;
    this.totalElapsedMs += dt;

    if (this.status === 'running') {
      this.evaluate(step, sample, dt);
      if (this.isDone()) return [...cmds, { type: 'free' }];
    }
    if (this.needCommand) {
      this.needCommand = false;
      cmds.push(this.currentCommand());
    }

    // Advance through steps (possibly several if dt was large).
    while (!this.done && this.stepElapsedMs >= this.currentStep.durationSec * 1000) {
      const finished = this.currentStep;
      this.stepElapsedMs -= finished.durationSec * 1000;
      this.onStepFinished(finished);
      if (this.isDone()) return [...cmds, { type: 'free' }];
      this.stepIndex += 1;
      if (this.stepIndex >= this.challenge.steps.length) {
        this.finishNaturally();
        return [...cmds, { type: 'free' }];
      }
      this.lowCadenceMs = 0;
      cmds.push(this.currentCommand());
    }
    return cmds;
  }

  /** User pressed Finish/Abort. During cooldown this keeps the already-decided result. */
  abort(): TrainerCommand[] {
    if (this.status === 'done') return [];
    if (this.result) {
      this.status = 'done';
    } else if (this.challenge.success.kind === 'ramp') {
      // "I'm done" during a ramp test: score it and roll into the cooldown.
      this.endRamp('You stopped the test.', true);
      this.needCommand = false;
      return [this.currentCommand()];
    } else {
      const reason = this.challenge.workout ? 'Workout ended early.' : 'Challenge abandoned.';
      this.result = { passed: false, aborted: true, reason, bestAvgPower: this.bestAvgOrUndef() };
      this.status = 'done';
    }
    return [{ type: 'free' }];
  }

  snapshot(): RunSnapshot {
    const step = this.currentStep;
    const target = step.mode === 'erg' && step.targetPctFtp != null && !this.manualPause ? this.targetWatts(step.targetPctFtp) : null;
    const { progress, label } = this.ruleProgress();
    return {
      challengeId: this.challenge.id,
      status: this.status,
      stepIndex: this.stepIndex,
      step,
      stepElapsedSec: this.stepElapsedMs / 1000,
      stepRemainingSec: Math.max(0, step.durationSec - this.stepElapsedMs / 1000),
      totalElapsedSec: this.totalElapsedMs / 1000,
      targetWatts: target,
      ruleProgress: progress,
      ruleLabel: label,
      crackSec: this.lowCadenceMs / 1000,
      paused: this.paused,
      manualPause: this.manualPause,
      intensityPct: this.intensityPct,
      offsetW: this.offsetW,
      result: this.result,
    };
  }

  // ---- internals ----------------------------------------------------------

  private watts(pct: number) {
    return Math.round((pct / 100) * this.ftp);
  }

  /** ERG target including the rider's adjustments (always ≥ 0). */
  private targetWatts(pct: number) {
    return Math.max(0, Math.round((pct / 100) * this.ftp * (this.intensityPct / 100) + this.offsetW));
  }

  private isDone() {
    return this.status === 'done';
  }

  private evaluate(step: Step, sample: TrainerSample, dt: number) {
    const rule = this.challenge.success;

    // Crack detection on ERG work steps (challenges only; workouts pause instead).
    if (step.mode === 'erg' && step.kind === 'work' && !this.challenge.workout) {
      const threshold = rule.kind === 'ramp' ? RAMP_CRACK_CADENCE : CRACK_CADENCE;
      this.lowCadenceMs = sample.cadence < threshold ? this.lowCadenceMs + dt : 0;
      if (this.lowCadenceMs >= CRACK_SEC * 1000) {
        if (rule.kind === 'ramp') {
          this.endRamp('You cracked. Nice work.', true);
        } else {
          this.result = { passed: false, aborted: false, reason: `You cracked on "${step.label}". Cadence dropped below ${threshold} rpm.` };
          this.status = 'done';
        }
        return;
      }
    }

    // Track power for rolling windows (ramp uses 60 s best; bestAvg uses its window).
    const tracksPower = rule.kind === 'ramp' ? step.kind === 'work' : rule.kind === 'bestAvg' && step.kind === 'effort';
    if (tracksPower) {
      const windowSec = rule.kind === 'bestAvg' ? rule.windowSec : 60;
      this.pts.push({ t: sample.t, power: sample.power, dt });
      const avg = this.rollingAvg(windowSec);
      if (avg != null && avg > this.bestAvg) this.bestAvg = avg;
      if (rule.kind === 'bestAvg' && this.bestAvg >= this.watts(rule.pctFtp)) {
        this.pass(`Target hit: ${Math.round(this.bestAvg)} W for ${rule.windowSec}s.`);
        this.skipToCooldown();
      }
    }

    if (rule.kind === 'cadence' && step.kind === 'effort') {
      if (sample.cadence >= rule.rpm) {
        this.cadenceStreakMs += dt;
        this.cadenceGraceMs = 0;
      } else {
        // allow 2 s of slop before resetting the streak
        this.cadenceGraceMs += dt;
        if (this.cadenceGraceMs > 2000) this.cadenceStreakMs = 0;
      }
      if (this.cadenceStreakMs >= rule.durationSec * 1000) {
        this.pass(`Held ${rule.rpm}+ rpm for ${rule.durationSec}s.`);
        this.skipToCooldown();
      }
    }
  }

  private onStepFinished(step: Step) {
    const rule = this.challenge.success;
    if (rule.kind === 'ramp' && step.kind === 'work') this.rampStepsCompleted += 1;

    const remainingScored = this.challenge.steps
      .slice(this.stepIndex + 1)
      .some((s) => s.kind === 'work' || s.kind === 'rest' || s.kind === 'effort');
    if (this.result || remainingScored) return;

    // That was the last scored step.
    if (rule.kind === 'completeAll') {
      this.pass(this.challenge.workout ? 'Workout complete. Nice training!' : 'All intervals completed.');
    } else if (rule.kind === 'ramp') {
      this.endRamp('You finished every ramp step.', false);
    } else if (step.kind === 'effort' || step.kind === 'work' || step.kind === 'rest') {
      this.result = {
        passed: false,
        aborted: false,
        reason: rule.kind === 'bestAvg'
          ? `Best ${rule.windowSec}s average was ${Math.round(this.bestAvg)} W. You needed ${this.watts(rule.pctFtp)} W.`
          : `Couldn't hold ${rule.kind === 'cadence' ? rule.rpm : ''} rpm long enough.`,
        bestAvgPower: this.bestAvgOrUndef(),
      };
      this.status = 'cooldown';
    }
  }

  private pass(reason: string) {
    this.result = { passed: true, aborted: false, reason, bestAvgPower: this.bestAvgOrUndef() };
    this.status = 'cooldown';
  }

  /** @param skip jump straight to the cooldown (mid-step crack/stop) vs. letting the step loop advance naturally */
  private endRamp(reason: string, skip: boolean) {
    const best = this.bestAvg;
    const newFtp = best > 0 ? Math.round(best * 0.75) : undefined;
    this.result = {
      passed: this.rampStepsCompleted >= 3 && newFtp != null,
      aborted: false,
      reason: newFtp ? `${reason} Best minute: ${Math.round(best)} W, so your new FTP is ${newFtp} W.` : `${reason} Not enough data to set an FTP.`,
      bestMinutePower: best > 0 ? Math.round(best) : undefined,
      newFtp,
      rampStepsCompleted: this.rampStepsCompleted,
    };
    this.status = 'cooldown';
    if (skip) this.skipToCooldown();
  }

  private skipToCooldown() {
    const idx = this.challenge.steps.findIndex((s, i) => i > this.stepIndex && s.kind === 'cooldown');
    if (idx === -1) {
      this.status = 'done';
      return;
    }
    this.stepIndex = idx;
    this.stepElapsedMs = 0;
    this.needCommand = true;
  }

  private finishNaturally() {
    if (!this.result) this.result = { passed: true, aborted: false, reason: 'Done.' };
    this.status = 'done';
  }

  private rollingAvg(windowSec: number): number | null {
    const windowMs = windowSec * 1000;
    let covered = 0;
    let sum = 0;
    for (let i = this.pts.length - 1; i >= 0 && covered < windowMs; i--) {
      const p = this.pts[i];
      const use = Math.min(p.dt, windowMs - covered);
      sum += p.power * use;
      covered += use;
    }
    // trim old points
    while (this.pts.length > 2000) this.pts.shift();
    if (covered < windowMs - 1) return null;
    return sum / covered;
  }

  private bestAvgOrUndef() {
    return this.bestAvg > 0 ? Math.round(this.bestAvg) : undefined;
  }

  private ruleProgress(): { progress: number; label: string } {
    const rule = this.challenge.success;
    const steps = this.challenge.steps;
    if (this.challenge.workout) {
      const total = steps.reduce((a, s) => a + s.durationSec, 0);
      const done = Math.min(total, steps.slice(0, this.stepIndex).reduce((a, s) => a + s.durationSec, 0) + this.stepElapsedMs / 1000);
      const p = this.status === 'done' && this.result?.passed ? 1 : done / Math.max(1, total);
      return { progress: p, label: `${Math.floor(p * 100)}% done · ${fmtDur(total - done)} left` };
    }
    switch (rule.kind) {
      case 'completeAll': {
        const work = steps.filter((s) => s.kind === 'work');
        const done = steps.slice(0, this.stepIndex).filter((s) => s.kind === 'work').length;
        return { progress: this.result?.passed ? 1 : done / Math.max(1, work.length), label: `${done}/${work.length} intervals` };
      }
      case 'bestAvg': {
        const target = this.watts(rule.pctFtp);
        return { progress: Math.min(1, this.bestAvg / target), label: `Best ${rule.windowSec}s: ${Math.round(this.bestAvg)} / ${target} W` };
      }
      case 'cadence':
        return {
          progress: Math.min(1, this.cadenceStreakMs / (rule.durationSec * 1000)),
          label: `${Math.floor(this.cadenceStreakMs / 1000)} / ${rule.durationSec}s at ${rule.rpm}+ rpm`,
        };
      case 'ramp':
        return {
          progress: Math.min(1, this.rampStepsCompleted / 20),
          label: `Best minute: ${Math.round(this.bestAvg)} W · est. FTP ${Math.round(this.bestAvg * 0.75)} W`,
        };
    }
  }
}
