import { challengeById } from './challenges';
import { challengeBoard, challengeReward } from './rewards';

const tabata = challengeById('tabata')!; // 300 XP
const pass = { passed: true, aborted: false, reason: '' };

describe('challengeReward', () => {
  it('pays full on first completion, 25% on repeats', () => {
    expect(challengeReward({ challenge: tabata, result: pass, previousCompletions: 0, isBounty: false, oldFtp: 200 }).xp).toBe(300);
    expect(challengeReward({ challenge: tabata, result: pass, previousCompletions: 2, isBounty: false, oldFtp: 200 }).xp).toBe(75);
  });

  it('applies the bounty multiplier', () => {
    expect(challengeReward({ challenge: tabata, result: pass, previousCompletions: 0, isBounty: true, oldFtp: 200 }).xp).toBe(450);
  });

  it('pays nothing on failure', () => {
    expect(challengeReward({ challenge: tabata, result: { ...pass, passed: false }, previousCompletions: 0, isBounty: false, oldFtp: 200 }).xp).toBe(0);
  });

  it('adds capped FTP-gain bonus for ramp tests', () => {
    const ramp = challengeById('ramp-test')!;
    const r = challengeReward({ challenge: ramp, result: { ...pass, newFtp: 210 }, previousCompletions: 1, isBounty: false, oldFtp: 200 });
    expect(r.xp).toBe(Math.round(150 * 0.25) + 100);
    const big = challengeReward({ challenge: ramp, result: { ...pass, newFtp: 300 }, previousCompletions: 1, isBounty: false, oldFtp: 200 });
    expect(big.xp).toBe(Math.round(150 * 0.25) + 300);
  });
});

describe('challengeBoard', () => {
  it('shows the next promotion and locks high-level challenges', () => {
    const b = challengeBoard(3, [], {}, undefined);
    expect(b[0].challenge.id).toBe('promo-5');
    expect(b[0].availability).toBe('locked');
    expect(b.find((e) => e.challenge.id === 'tabata')!.availability).toBe('locked');
    expect(b.find((e) => e.challenge.id === 'ramp-test')!.availability).toBe('available');
  });

  it('offers the promo at the gate and moves on once cleared', () => {
    expect(challengeBoard(5, [], {}, undefined)[0]).toMatchObject({ availability: 'available' });
    expect(challengeBoard(5, [5], {}, undefined)[0].challenge.id).toBe('promo-10');
    expect(challengeBoard(7, [5], {}, undefined)[0].challenge.id).toBe('promo-10');
  });
});

describe('workout rewards', () => {
  const z2 = challengeById('wk-z2-60')!;
  it('pays full XP on every completion', () => {
    expect(challengeReward({ challenge: z2, result: pass, previousCompletions: 0, isBounty: false, oldFtp: 200 }).xp).toBe(z2.xpReward);
    expect(challengeReward({ challenge: z2, result: pass, previousCompletions: 9, isBounty: false, oldFtp: 200 }).xp).toBe(z2.xpReward);
  });
  it('pays nothing when ended early', () => {
    expect(challengeReward({ challenge: z2, result: { ...pass, passed: false, aborted: true }, previousCompletions: 0, isBounty: false, oldFtp: 200 }).xp).toBe(0);
  });
});
