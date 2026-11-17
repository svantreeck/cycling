import { RAMP_TEST } from '../game/challenges';
import { localDate, todayBonusId } from './gameStore';
import { defaultProfile, type Profile } from './persistence';

const NOW = new Date(2026, 10, 17, 18, 0).getTime();
const tested = (): Profile => ({ ...defaultProfile(), ftpHistory: [{ at: NOW - 30 * 86400000, ftp: 220 }] });

describe("today's ride bonus", () => {
  it("goes to the coach's suggestion (the ramp test for an untested rider)", () => {
    expect(todayBonusId(defaultProfile(), null, NOW)).toBe(RAMP_TEST.id);
  });

  it('follows a swap picked on the Today card', () => {
    const p = tested();
    const suggested = todayBonusId(p, null, NOW)!;
    expect(todayBonusId(p, { suggestionId: suggested, workoutId: 'wk-z2-45' }, NOW)).toBe('wk-z2-45');
    // A pick made for an older suggestion no longer applies.
    expect(todayBonusId(p, { suggestionId: 'something-else', workoutId: 'wk-z2-45' }, NOW)).toBe(suggested);
  });

  it('is gone once claimed today', () => {
    expect(todayBonusId({ ...tested(), bonusClaimedOn: localDate(new Date(NOW)) }, null, NOW)).toBeUndefined();
  });

  it('is not offered on a rest day', () => {
    const rode: Profile = {
      ...tested(),
      rides: [
        { id: 'r', startedAt: NOW - 3600_000, durationSec: 3600, kj: 800, avgPower: 220, maxPower: 300, zoneSec: [0, 0, 0, 3600, 0, 0, 0], xpEarned: 100, challenges: [], tss: 90 },
      ],
    };
    expect(todayBonusId(rode, null, NOW)).toBeUndefined();
  });
});
