import { useState } from 'react';
import { totalDurationSec, fmtDur, WORKOUTS, type Challenge, type FitnessSystem, type WorkoutCategory } from '../game/challenges';
import { REPEAT_FACTOR, BOUNTY_FACTOR, challengeBoard } from '../game/rewards';
import { todayBonusId, useGame } from '../store/gameStore';
import { WorkoutProfile } from './WorkoutProfile';

const CATEGORIES: { id: WorkoutCategory | 'all'; label: string; blurb: string }[] = [
  { id: 'all', label: 'All', blurb: 'Structured rides with targets set from your FTP. The trainer holds the watts, so just pedal.' },
  { id: 'endurance', label: 'Zone 2', blurb: 'Easy, steady riding at 56–75% FTP. It builds your aerobic engine and should be most of your riding.' },
  { id: 'tempo', label: 'Tempo', blurb: 'Steady, moderately hard riding at 76–90% FTP. Builds stamina for long climbs and strong group rides.' },
  { id: 'sweetspot', label: 'Sweet Spot', blurb: 'Hard but sustainable work at 88–94% FTP. You get a lot of fitness for the time spent.' },
  { id: 'threshold', label: 'Threshold', blurb: 'Efforts at 95–105% FTP. They raise the power you can hold for about an hour.' },
  { id: 'vo2max', label: 'VO₂max', blurb: 'Hard 2–5 minute efforts at 106–120% FTP. They raise your aerobic ceiling. One a week is plenty.' },
  { id: 'anaerobic', label: 'Anaerobic', blurb: 'Short, very hard efforts above 120% FTP. Builds punch for attacks and short climbs.' },
  { id: 'sprint', label: 'Sprint', blurb: 'All-out sprints on free resistance: shift into a big gear and go. Full recovery between each one.' },
];

type Length = 'any' | 'short' | 'medium' | 'long';
const LENGTHS: { id: Length; label: string; test: (min: number) => boolean }[] = [
  { id: 'any', label: 'Any length', test: () => true },
  { id: 'short', label: '≤ 35 min', test: (m) => m <= 35 },
  { id: 'medium', label: '35–65 min', test: (m) => m > 35 && m <= 65 },
  { id: 'long', label: '65+ min', test: (m) => m > 65 },
];

const SYSTEM_LABEL: Record<FitnessSystem, string> = {
  endurance: 'Endurance',
  tempo: 'Tempo',
  threshold: 'Threshold',
  vo2max: 'VO₂max',
  anaerobic: 'Anaerobic',
};

export function ChallengeBoard() {
  const { profile, startChallenge, conn, run, setScreen, todayPick } = useGame();
  const [cat, setCat] = useState<WorkoutCategory | 'all'>('all');
  const [len, setLen] = useState<Length>('any');
  const bonusId = todayBonusId(profile, todayPick);
  const entries = challengeBoard(profile.levels.level, profile.completed, bonusId);
  const connected = conn === 'connected';
  const lengthOk = LENGTHS.find((l) => l.id === len)!.test;
  const catOrder = CATEGORIES.map((c) => c.id);
  const workouts = WORKOUTS.filter((w) => (cat === 'all' || w.workout!.category === cat) && lengthOk(totalDurationSec(w) / 60)).sort(
    (a, b) => catOrder.indexOf(a.workout!.category) - catOrder.indexOf(b.workout!.category) || a.workout!.rung - b.workout!.rung,
  );

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
      <div className="filter-row">
        {LENGTHS.map((l) => (
          <button key={l.id} className={`chip small ${len === l.id ? 'active' : ''}`} onClick={() => setLen(l.id)}>
            {l.label}
          </button>
        ))}
      </div>
      <p className="muted small">{CATEGORIES.find((c) => c.id === cat)!.blurb}</p>
      {workouts.length === 0 && <p className="muted">No workouts of that length here. Try another length.</p>}
      <div className="board-grid">
        {workouts.map((c) => {
          const rec = profile.completed[c.id];
          const bonus = c.id === bonusId;
          return (
            <div key={c.id} className={`card ch workout cat-${c.workout!.category} ${bonus ? 'bounty' : ''}`}>
              <div className="ch-top">
                {bonus && <span className="pill gold">★ Today's ride ×{BOUNTY_FACTOR}</span>}
                <span className="pill tier">{c.workout!.focus}</span>
                <span className="pill">{c.workout!.tss} TSS</span>
                <span className="pill rungs" title="Difficulty within this category">
                  {'▮'.repeat(c.workout!.rung)}
                  <span className="dim">{'▮'.repeat(c.workout!.rungs - c.workout!.rung)}</span>
                </span>
              </div>
              <h3>{c.name}</h3>
              <WorkoutProfile steps={c.steps} small />
              <p className="muted">{c.description}</p>
              {c.workout!.trains.length > 0 && (
                <div className="muted small">Builds: {c.workout!.trains.map((t) => SYSTEM_LABEL[t]).join(' + ')}</div>
              )}
              <div className="ch-meta">
                <span>⏱ {fmtDur(totalDurationSec(c))}</span>
                <span className="xp">+{bonus ? Math.round(c.xpReward * BOUNTY_FACTOR) : c.xpReward} XP</span>
                {rec && rec.count > 0 && <span className="muted">✓ ×{rec.count}</span>}
              </div>
              {startButton(c)}
            </div>
          );
        })}
      </div>

      <div className="board-head">
        <h2>Challenges</h2>
        <span className="muted">Pass/fail tests that earn bonus XP. Promotions come from completing training blocks.</span>
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
            <div key={c.id} className={`card ch ${availability} ${isBounty ? 'bounty' : ''}`}>
              <div className="ch-top">
                <span className="pill tier">Tier {c.tier}</span>
                {isBounty && <span className="pill gold">★ Today's ride ×{BOUNTY_FACTOR}</span>}
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
