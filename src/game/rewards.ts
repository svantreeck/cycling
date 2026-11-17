import type { RunResult } from './challengeEngine';
import { CHALLENGES, promotionChallenge, type Challenge } from './challenges';
import { PROMOTION_EVERY } from './xp';

export const REPEAT_FACTOR = 0.25;
export const BOUNTY_FACTOR = 1.5;
export const FTP_GAIN_XP_PER_WATT = 10;
export const FTP_GAIN_XP_CAP = 300;

export interface RewardInput {
  challenge: Challenge;
  result: RunResult;
  previousCompletions: number;
  isBounty: boolean;
  oldFtp: number;
}

export interface Reward {
  xp: number;
  lines: string[];
}

export function challengeReward({ challenge, result, previousCompletions, isBounty, oldFtp }: RewardInput): Reward {
  if (!result.passed) {
    const what = challenge.workout ? 'workout bonus' : 'challenge XP';
    return { xp: 0, lines: [`No ${what} this time, but your ride XP still counts.`] };
  }
  if (challenge.workout) {
    // Training is meant to be repeated, so workouts pay full every time.
    return { xp: challenge.xpReward, lines: [`Workout bonus: ${challenge.xpReward} XP (training load ${challenge.workout.tss} TSS)`] };
  }
  const lines: string[] = [];
  let base = challenge.xpReward;
  if (previousCompletions > 0) {
    base = Math.round(base * REPEAT_FACTOR);
    lines.push(`Repeat completion: ${base} XP (${REPEAT_FACTOR * 100}% of ${challenge.xpReward})`);
  } else {
    lines.push(`First completion: ${base} XP`);
  }
  if (isBounty) {
    const bonus = Math.round(base * (BOUNTY_FACTOR - 1));
    base += bonus;
    lines.push(`Daily bounty ×${BOUNTY_FACTOR}: +${bonus} XP`);
  }
  let xp = base;
  if (result.newFtp != null && result.newFtp > oldFtp) {
    const gain = Math.min(FTP_GAIN_XP_CAP, (result.newFtp - oldFtp) * FTP_GAIN_XP_PER_WATT);
    xp += gain;
    lines.push(`FTP up ${result.newFtp - oldFtp} W: +${gain} XP`);
  }
  return { xp, lines };
}

export type Availability = 'available' | 'locked' | 'completed';

export interface BoardEntry {
  challenge: Challenge;
  availability: Availability;
  isBounty: boolean;
}

/** Challenges to show on the board for a rider at `level`. */
export function challengeBoard(
  level: number,
  promotionsCleared: number[],
  completed: Record<string, { count: number }>,
  bountyId: string | undefined,
): BoardEntry[] {
  const entries: BoardEntry[] = [];
  // Promotion for the next uncleared gate, at the top.
  const gate = Math.max(PROMOTION_EVERY, Math.ceil(level / PROMOTION_EVERY) * PROMOTION_EVERY);
  const nextGate = promotionsCleared.includes(gate) ? gate + PROMOTION_EVERY : gate;
  const promo = promotionChallenge(nextGate);
  entries.push({ challenge: promo, availability: level >= promo.minLevel ? 'available' : 'locked', isBounty: false });

  for (const c of CHALLENGES) {
    const done = (completed[c.id]?.count ?? 0) > 0;
    entries.push({
      challenge: c,
      availability: level < c.minLevel ? 'locked' : done && !c.repeatable ? 'completed' : 'available',
      isBounty: c.id === bountyId,
    });
  }
  return entries;
}
