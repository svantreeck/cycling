/**
 * Virtual gears for free riding on a single real gear (e.g. Zwift Cog). Each gear sets the trainer's simulated
 * grade, so shifting up makes the same cadence harder, much like a real cassette. ERG mode ignores gears.
 */

export const GEAR_COUNT = 24;
/** Gear that feels like a flat road. */
export const DEFAULT_GEAR = 8;
/** Simulated grade change per gear, in percent. */
export const GRADE_PER_GEAR = 0.5;

export const clampGear = (g: number) => Math.min(GEAR_COUNT, Math.max(1, Math.round(g)));

/** Simulated grade for a gear: gear 1 ≈ −3.5% (spinny), gear 24 = +8% (big gear). */
export const gradeForGear = (g: number) => Math.round((clampGear(g) - DEFAULT_GEAR) * GRADE_PER_GEAR * 10) / 10;
