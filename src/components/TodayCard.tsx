import { useMemo, useState } from 'react';
import { challengeById, fmtDur, totalDurationSec, trainingStress, type Challenge } from '../game/challenges';
import { suggestToday, swapsFor, trainingLoad, type SuggestionKind } from '../game/coach';
import { useGame } from '../store/gameStore';
import { WorkoutProfile } from './WorkoutProfile';

const KIND_LABEL: Record<SuggestionKind, string> = {
  test: 'FTP test',
  rest: 'Rest day',
  recovery: 'Recovery',
  endurance: 'Easy day',
  hard: 'Key workout',
};

const FORM_HINT: Record<string, string> = {
  Fresh: 'Well rested. A good time for a hard session or a test.',
  Neutral: 'Balanced: training and recovery are in step.',
  Building: "Productive fatigue: you're building fitness.",
  Overreaching: 'Very tired. Back off for a few days.',
};

export function TodayCard() {
  const { profile } = useGame();
  const { rides, ftpHistory, completed, ftp, plan } = profile;
  const suggestion = useMemo(() => suggestToday({ ftp, ftpHistory, completed, rides, plan }), [ftp, ftpHistory, completed, rides, plan]);
  const load = useMemo(() => trainingLoad(rides), [rides]);
  // Re-mount (resetting any swaps) when the suggestion itself changes, e.g. after a ride.
  return <TodayInner key={suggestion.workout.id + suggestion.kind} suggestion={suggestion} load={load} />;
}

function TodayInner({ suggestion, load }: { suggestion: ReturnType<typeof suggestToday>; load: ReturnType<typeof trainingLoad> }) {
  const { conn, run, startChallenge, setScreen } = useGame();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const workout: Challenge = (chosenId && challengeById(chosenId)) || suggestion.workout;
  const swapped = workout.id !== suggestion.workout.id;
  const swaps = swapsFor(workout);
  const connected = conn === 'connected';
  const tss = workout.workout?.tss ?? trainingStress(workout.steps);

  const swapBtn = (label: string, target: Challenge | null) => (
    <button className="chip small" disabled={!target} title={target ? `${target.name} · ${fmtDur(totalDurationSec(target))}` : undefined} onClick={() => target && setChosenId(target.id)}>
      {label}
    </button>
  );

  return (
    <section className={`card today kind-${suggestion.kind}`}>
      <div className="today-head">
        <h2>Today's ride</h2>
        <span className="pill gold">{KIND_LABEL[suggestion.kind]}</span>
      </div>

      <div className="load-strip" title="Training load from your recent rides">
        <span title="Fitness: your 6-week average daily training load">
          Fitness <strong>{load.fitness}</strong>
        </span>
        <span title="Fatigue: your 1-week average daily training load">
          Fatigue <strong>{load.fatigue}</strong>
        </span>
        <span title={FORM_HINT[load.formLabel]}>
          Form <strong className={`form-${load.formLabel.toLowerCase()}`}>{load.form > 0 ? `+${load.form}` : load.form} · {load.formLabel}</strong>
        </span>
        <span title="Training stress over the last 7 days">
          Last 7 days <strong>{load.weekTss} TSS</strong>
        </span>
      </div>

      <p className="today-reason">{suggestion.reason}</p>
      {swapped && (
        <p className="muted small">
          Swapped from {suggestion.workout.name}.{' '}
          <button className="link" onClick={() => setChosenId(null)}>
            Back to the suggestion
          </button>
        </p>
      )}

      <div className="today-workout">
        <div className="today-title">
          {workout.workout && <span className="pill tier">{workout.workout.focus}</span>}
          <h3>{workout.name}</h3>
        </div>
        <WorkoutProfile steps={workout.steps} small />
        <div className="ch-meta">
          <span>⏱ {fmtDur(totalDurationSec(workout))}</span>
          <span>{tss} TSS</span>
          <span className="xp">+{workout.xpReward} XP</span>
        </div>
      </div>

      <div className="today-actions">
        <button className="btn primary big" disabled={!connected || !!run} onClick={() => startChallenge(workout.id)}>
          {run ? 'Ride in progress' : `Start ${workout.name}`}
        </button>
        <div className="swap-row">
          {swapBtn('Shorter', swaps.shorter)}
          {swapBtn('Easier', swaps.easier)}
          {swapBtn('Harder', swaps.harder)}
          <button className="link small" onClick={() => setScreen('challenges')}>
            All workouts →
          </button>
        </div>
      </div>
      {!connected && <p className="muted small">Connect your trainer above to start.</p>}
    </section>
  );
}
