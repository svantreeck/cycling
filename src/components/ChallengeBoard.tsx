import { totalDurationSec, fmtDur } from '../game/challenges';
import { REPEAT_FACTOR, BOUNTY_FACTOR, challengeBoard } from '../game/rewards';
import { activeBounty, useGame } from '../store/gameStore';

export function ChallengeBoard() {
  const { profile, startChallenge, conn, run, setScreen } = useGame();
  const bounty = activeBounty(profile);
  const entries = challengeBoard(profile.levels.level, profile.levels.promotionsCleared, profile.completed, bounty?.id);
  const connected = conn === 'connected';

  return (
    <div className="board">
      <div className="board-head">
        <h2>Challenges</h2>
        <span className="muted">
          FTP {profile.ftp} W · Targets scale with your FTP
          {!connected && (
            <>
              {' · '}
              <button className="link" onClick={() => setScreen('home')}>
                connect a trainer
              </button>{' '}
              to start
            </>
          )}
        </span>
      </div>
      <div className="board-grid">
        {entries.map(({ challenge: c, availability, isBounty }) => {
          const rec = profile.completed[c.id];
          const repeat = (rec?.count ?? 0) > 0;
          let xp = repeat ? Math.round(c.xpReward * REPEAT_FACTOR) : c.xpReward;
          if (isBounty) xp = Math.round(xp * BOUNTY_FACTOR);
          const hasErg = c.steps.some((s) => s.kind !== 'warmup' && s.kind !== 'cooldown' && s.mode === 'erg');
          const locked = availability === 'locked';
          return (
            <div key={c.id} className={`card ch ${availability} ${c.promotionFor ? 'promo' : ''} ${isBounty ? 'bounty' : ''}`}>
              <div className="ch-top">
                <span className="pill tier">{c.promotionFor ? 'PROMOTION' : `Tier ${c.tier}`}</span>
                {isBounty && <span className="pill gold">★ Daily bounty ×{BOUNTY_FACTOR}</span>}
                <span className="pill">{c.success.kind === 'ramp' ? 'Test' : hasErg ? 'ERG' : 'Free effort'}</span>
              </div>
              <h3>
                {locked && '🔒 '}
                {c.name}
              </h3>
              <p className="muted">{c.description}</p>
              <div className="ch-meta">
                <span>⏱ {fmtDur(totalDurationSec(c))}</span>
                <span className="xp">+{xp} XP{repeat ? ' (repeat)' : ''}</span>
                {rec && <span className="muted">✓ {rec.count}/{rec.attempts}</span>}
              </div>
              {locked ? (
                <div className="muted small">Unlocks at level {c.minLevel}</div>
              ) : availability === 'completed' ? (
                <div className="muted small">Completed</div>
              ) : (
                <button className="btn primary" disabled={!connected || !!run} onClick={() => startChallenge(c.id)}>
                  {run ? 'Challenge in progress' : 'Start'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
