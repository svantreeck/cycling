import { useState } from 'react';
import { totalDurationSec, fmtDur, WORKOUTS, type Challenge, type WorkoutCategory } from '../game/challenges';
import { REPEAT_FACTOR, BOUNTY_FACTOR, challengeBoard } from '../game/rewards';
import { activeBounty, useGame } from '../store/gameStore';
import { WorkoutProfile } from './WorkoutProfile';

const CATEGORIES: { id: WorkoutCategory | 'all'; label: string; blurb: string }[] = [
  { id: 'all', label: 'All', blurb: 'Structured rides with targets set from your FTP. The trainer holds the watts, so just pedal.' },
  { id: 'endurance', label: 'Zone 2', blurb: 'Easy, steady riding at 56–75% FTP. It builds your aerobic engine and should be most of your riding.' },
  { id: 'sweetspot', label: 'Sweet Spot', blurb: 'Hard but sustainable work at 88–94% FTP. You get a lot of fitness for the time spent.' },
  { id: 'intervals', label: 'Intervals', blurb: 'Threshold, VO₂max and anaerobic efforts. Do one or two a week, with easy days around them.' },
];

export function ChallengeBoard() {
  const { profile, startChallenge, conn, run, setScreen } = useGame();
  const [cat, setCat] = useState<WorkoutCategory | 'all'>('all');
  const bounty = activeBounty(profile);
  const entries = challengeBoard(profile.levels.level, profile.levels.promotionsCleared, profile.completed, bounty?.id);
  const connected = conn === 'connected';
  const workouts = WORKOUTS.filter((w) => cat === 'all' || w.workout!.category === cat);

  const startButton = (c: Challenge) => (
    <button className="btn primary" disabled={!connected || !!run} onClick={() => startChallenge(c.id)}>
      {run ? 'Ride in progress' : 'Start'}
    </button>
  );

  return (
    <div className="board">
      <div className="board-head">
        <h2>Workouts</h2>
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
      <div className="filter-row">
        {CATEGORIES.map((c) => (
          <button key={c.id} className={`chip ${cat === c.id ? 'active' : ''}`} onClick={() => setCat(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <p className="muted small">{CATEGORIES.find((c) => c.id === cat)!.blurb}</p>
      <div className="board-grid">
        {workouts.map((c) => {
          const rec = profile.completed[c.id];
          return (
            <div key={c.id} className={`card ch workout cat-${c.workout!.category}`}>
              <div className="ch-top">
                <span className="pill tier">{c.workout!.focus}</span>
                <span className="pill">{c.workout!.tss} TSS</span>
              </div>
              <h3>{c.name}</h3>
              <WorkoutProfile steps={c.steps} small />
              <p className="muted">{c.description}</p>
              <div className="ch-meta">
                <span>⏱ {fmtDur(totalDurationSec(c))}</span>
                <span className="xp">+{c.xpReward} XP</span>
                {rec && rec.count > 0 && <span className="muted">✓ ×{rec.count}</span>}
              </div>
              {startButton(c)}
            </div>
          );
        })}
      </div>

      <div className="board-head">
        <h2>Challenges</h2>
        <span className="muted">Pass/fail tests that earn bonus XP. Promotion Trials unlock the next levels.</span>
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
                startButton(c)
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
