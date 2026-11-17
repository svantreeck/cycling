import { CRACK_SEC } from '../game/challengeEngine';
import { challengeById, fmtDur, roman } from '../game/challenges';
import { useGame } from '../store/gameStore';
import { stepColor, WorkoutProfile } from './WorkoutProfile';

export function ChallengeRunner() {
  const { runSnap: snap, run, abortChallenge, sample, outcome, dismissOutcome } = useGame();
  if (!snap) return null;
  const challenge = run?.challenge ?? challengeById(snap.challengeId);
  if (!challenge) return null;

  if (outcome) return <OutcomeCard onClose={dismissOutcome} />;

  const { step } = snap;
  const isRamp = challenge.success.kind === 'ramp';
  const isWorkout = !!challenge.workout;
  const total = challenge.steps.reduce((a, s) => a + s.durationSec, 0);
  const elapsedBefore = challenge.steps.slice(0, snap.stepIndex).reduce((a, s) => a + s.durationSec, 0);
  const cursorPct = ((elapsedBefore + snap.stepElapsedSec) / total) * 100;
  const power = sample?.power ?? 0;
  const next = challenge.steps[snap.stepIndex + 1];

  return (
    <div className={`card runner kind-${step.kind}`}>
      <div className="runner-head">
        <div>
          <div className="runner-name">{challenge.name}</div>
          <div className="runner-step">
            <span className="pill" style={{ background: stepColor(step) }}>
              {step.kind.toUpperCase()}
            </span>{' '}
            {step.label}
            {step.mode === 'free' ? <span className="muted"> · free resistance, shift gears</span> : <span className="muted"> · ERG</span>}
          </div>
        </div>
        <div className="runner-countdown">{fmtCountdown(snap.stepRemainingSec)}</div>
      </div>

      <div className="runner-target">
        {snap.targetWatts != null ? (
          <>
            <div>
              <div className="muted small">Target</div>
              <div className="target-w">{snap.targetWatts} W</div>
            </div>
            <div>
              <div className="muted small">Actual</div>
              <div className="target-w" style={{ color: Math.abs(power - snap.targetWatts) < snap.targetWatts * 0.08 ? '#2ecc71' : '#f39c12' }}>
                {power} W
              </div>
            </div>
          </>
        ) : (
          <div className="go">
            {step.kind === 'effort' ? 'GO GO GO!' : 'Ride freely'}
            {step.targetPctFtp != null && run && (
              <span className="muted small"> aim ≥ {Math.round((step.targetPctFtp / 100) * run.ftp)} W</span>
            )}
          </div>
        )}
        {snap.result && <div className={`verdict ${snap.result.passed ? 'pass' : 'fail'}`}>{snap.result.passed ? '✓ ' : '✗ '}{snap.result.reason}</div>}
      </div>

      {snap.paused && <div className="paused-banner">⏸ Paused. Start pedalling to resume.</div>}

      {snap.crackSec > 0 && snap.status === 'running' && (
        <div className="crack-warn">Keep pedalling! Cracking in {Math.max(0, CRACK_SEC - snap.crackSec).toFixed(0)}s</div>
      )}

      <div className="rule">
        <div className="rule-label">{snap.ruleLabel}</div>
        <div className="rule-track">
          <div className="rule-fill" style={{ width: `${snap.ruleProgress * 100}%` }} />
        </div>
      </div>

      <WorkoutProfile steps={challenge.steps} currentIndex={snap.stepIndex} cursorPct={cursorPct} />

      <div className="runner-foot">
        <span className="muted small">{next ? `Next: ${next.label} · ${fmtDur(next.durationSec)}` : 'Last step'}</span>
        <button className={`btn ${snap.status === 'cooldown' ? 'primary' : isRamp ? 'primary' : 'danger'}`} onClick={abortChallenge}>
          {snap.status === 'cooldown' ? 'Finish' : isRamp ? "I'm done" : isWorkout ? 'End workout' : 'Abort'}
        </button>
      </div>
    </div>
  );
}

function OutcomeCard({ onClose }: { onClose: () => void }) {
  const o = useGame((s) => s.outcome)!;
  const ftp = useGame((s) => s.profile.ftp);
  const rateWorkout = useGame((s) => s.rateWorkout);
  const noun = o.challenge.workout ? 'Workout' : 'Challenge';
  return (
    <div className={`card outcome ${o.result.passed ? 'pass' : 'fail'}`}>
      <div className="outcome-icon">{o.result.passed ? '🏆' : '💥'}</div>
      <h2>{o.result.passed ? `${noun} complete!` : o.result.aborted ? (o.challenge.workout ? 'Workout ended early' : 'Challenge abandoned') : `${noun} failed`}</h2>
      <div className="outcome-name">{o.challenge.name}</div>
      <p>{o.result.reason}</p>
      {o.result.newFtp != null && o.result.passed && (
        <p className="ftp-change">
          FTP: {o.oldFtp} W → <strong>{ftp} W</strong> {ftp > o.oldFtp ? '📈' : ftp < o.oldFtp ? '📉' : ''}
        </p>
      )}
      <ul className="reward-lines">
        {o.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {o.xp > 0 && <div className="xp-burst">+{o.xp} XP</div>}
      {o.challenge.workout && o.result.passed && (
        <div className="checkin">
          <div className="checkin-q">How did that feel?</div>
          <div className="checkin-opts">
            {(
              [
                ['easy', '😌 Easy'],
                ['right', '👌 Just right'],
                ['hard', '🥵 Really hard'],
              ] as const
            ).map(([f, label]) => (
              <button key={f} className={`chip ${o.feel === f ? 'active' : ''}`} onClick={() => rateWorkout(f)}>
                {label}
              </button>
            ))}
          </div>
          {o.feel && (
            <div className="muted small">
              {o.feel === 'easy' ? 'Noted: the coach will step up faster.' : o.feel === 'hard' ? "Noted: you'll repeat this level before moving on." : 'Noted: next time is one step up.'}
            </div>
          )}
        </div>
      )}
      {o.promotion && <div className="promoted">🎖️ Block {o.promotion.block} complete: you're promoted to Rank {roman(o.promotion.rank)}!</div>}
      <button className="btn primary" onClick={onClose}>
        Keep riding
      </button>
    </div>
  );
}

function fmtCountdown(sec: number) {
  const s = Math.ceil(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
