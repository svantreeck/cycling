import { Emitter, type Trainer, type TrainerSample } from './trainer';

const TICK_MS = 250;

/**
 * Simulated smart trainer for developing without hardware.
 * - Free ride: emits `riderPower` (set by keyboard/slider).
 * - ERG: tracks the target with a little noise.
 * - Fatigue: cadence sags until the rider "cracks".
 * - timeWarp: sample timestamps advance faster than wall-clock so long challenges finish quickly.
 */
export class MockTrainer implements Trainer {
  readonly name = 'Simulator';
  readonly kind = 'mock' as const;
  readonly capabilities = { erg: true, simulation: true };

  riderPower = 0;
  riderCadence = 90;
  fatigued = false;
  timeWarp = 1;

  private ergTarget: number | null = null;
  private samples = new Emitter<TrainerSample>();
  private disconnects = new Emitter<void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private simT = Date.now();
  private fatigueLevel = 0;
  private smoothedPower = 0;

  async connect() {
    this.simT = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  async disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Simulate an unexpected Bluetooth drop. */
  simulateDrop() {
    void this.disconnect();
    this.disconnects.emit();
  }

  onSample(cb: (s: TrainerSample) => void) {
    return this.samples.on(cb);
  }

  onDisconnect(cb: () => void) {
    return this.disconnects.on(cb);
  }

  get currentErgTarget() {
    return this.ergTarget;
  }

  async setErgPower(watts: number) {
    this.ergTarget = Math.round(watts);
  }

  async setFreeRide() {
    this.ergTarget = null;
  }

  private tick() {
    // Under time warp, emit several sub-samples so no sample gap exceeds ~1 s of sim time
    // (consumers treat big gaps as dropouts).
    const simMs = TICK_MS * this.timeWarp;
    const n = Math.max(1, Math.ceil(simMs / 1000));
    for (let i = 0; i < n; i++) this.step(simMs / n);
  }

  private step(simMs: number) {
    this.simT += simMs;
    const dtS = simMs / 1000;

    this.fatigueLevel = this.fatigued
      ? Math.min(1, this.fatigueLevel + dtS / 20)
      : Math.max(0, this.fatigueLevel - dtS / 10);

    const pedalling = this.ergTarget != null ? this.riderPower > 0 || this.riderCadence > 0 : this.riderPower > 0;
    let cadence = pedalling ? this.riderCadence * (1 - 0.6 * this.fatigueLevel) : 0;
    let target = this.ergTarget ?? this.riderPower;
    if (this.ergTarget != null && cadence < 30) target = 0; // can't turn the pedals
    if (!pedalling) target = 0;

    // First-order lag so power doesn't jump instantly.
    this.smoothedPower += (target - this.smoothedPower) * Math.min(1, dtS / 1.5);
    const noise = target > 0 ? (Math.random() - 0.5) * 0.04 * target : 0;
    const power = Math.max(0, Math.round(this.smoothedPower + noise));
    cadence = cadence > 0 ? Math.max(0, Math.round(cadence + (Math.random() - 0.5) * 3)) : 0;
    const speedKph = power > 0 ? Math.cbrt(power / 0.25) * 3.6 : 0;

    this.samples.emit({ t: this.simT, power, cadence, speedKph: Math.round(speedKph * 10) / 10 });
  }
}
