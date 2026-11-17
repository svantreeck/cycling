export interface TrainerSample {
  /** ms timestamp */
  t: number;
  power: number;
  cadence: number;
  speedKph: number;
}

export interface TrainerCapabilities {
  erg: boolean;
  simulation: boolean;
}

export type Unsubscribe = () => void;

export interface Trainer {
  readonly name: string;
  readonly kind: 'ftms' | 'cps' | 'mock';
  readonly capabilities: TrainerCapabilities;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onSample(cb: (s: TrainerSample) => void): Unsubscribe;
  onDisconnect(cb: () => void): Unsubscribe;
  /** Hold the given wattage (ERG). No-op if unsupported. */
  setErgPower(watts: number): Promise<void>;
  /**
   * Release ERG: road simulation so the rider controls effort with gears.
   * `gradePct` is the simulated grade; virtual gears shift it (0 = flat road).
   */
  setFreeRide(gradePct?: number): Promise<void>;
}

/** Tiny typed event helper shared by trainer implementations. */
export class Emitter<T> {
  private listeners = new Set<(v: T) => void>();
  on(cb: (v: T) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  emit(v: T) {
    for (const l of this.listeners) l(v);
  }
}
