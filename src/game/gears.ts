/**
 * Virtual gears for free riding on one real gear (e.g. a Zwift Cog).
 *
 * Each gear is a gear ratio: shifting up makes every pedal stroke cover ~7.5% more virtual road, as on a real cassette.
 * The trainer itself only knows its own (fixed-gear) speed, so we ask it for the grade whose resistance at that speed
 * matches what the virtual gear would cost on a flat road. Because air drag grows with the cube of speed, that grade
 * depends on how fast you're going and is re-sent as speed changes. A shift then feels like a real one: about a quarter
 * more effort at the same cadence, and much harder to spin out a big gear.
 *
 * Gear 12 is 1:1 with the trainer (virtual speed = trainer speed, flat road). ERG mode ignores gears.
 */

export const GEAR_COUNT = 24;
/** Middle of the cassette, and the 1:1 gear. */
export const DEFAULT_GEAR = 12;
/** Road speed per pedal stroke gained by each shift up. */
export const GEAR_STEP = 1.075;

// The same physics constants are sent to the trainer, so its resistance model and ours agree.
export const CRR = 0.004;
/** wind resistance coefficient, 0.5·ρ·CdA in kg/m (the FTMS default) */
export const CW = 0.51;
/** rider + bike mass the grade is computed for (FTMS has no way to tell the trainer) */
const MASS_KG = 83;
const G = 9.81;
/** Trainer grade limits; KICKRs top out around +20%. */
export const MIN_GRADE = -10;
export const MAX_GRADE = 20;
/** Below this trainer speed (m/s) use this speed for the calculation, so starting from a standstill isn't a wall. */
const MIN_CALC_SPEED = 4;

export const clampGear = (g: number) => Math.min(GEAR_COUNT, Math.max(1, Math.round(g)));

/** Virtual road speed ÷ trainer speed for a gear. */
export const gearRatio = (g: number) => GEAR_STEP ** (clampGear(g) - DEFAULT_GEAR);

/** The road speed this gear gives at the trainer's speed (for display, distance and exports). */
export const virtualSpeedKph = (trainerKph: number, gear: number) => trainerKph * gearRatio(gear);

/**
 * Grade (percent, 0.1 resolution) to send the trainer so that pedalling at `trainerKph` costs what `gear` would cost
 * on a flat road. Resistance force on the trainer: m·g·(crr + grade) + cw·v². Power needed in the virtual gear at road
 * speed k·v: (m·g·crr + cw·(k·v)²)·k·v, which the rider delivers at the trainer's speed v.
 */
export function gradeForGear(gear: number, trainerKph: number): number {
  const v = Math.max(MIN_CALC_SPEED, trainerKph / 3.6);
  const k = gearRatio(gear);
  const roadForce = (MASS_KG * G * CRR + CW * (k * v) ** 2) * k; // power at road speed ÷ trainer speed
  const grade = ((roadForce - CW * v * v) / (MASS_KG * G) - CRR) * 100;
  return Math.round(Math.min(MAX_GRADE, Math.max(MIN_GRADE, grade)) * 10) / 10;
}
