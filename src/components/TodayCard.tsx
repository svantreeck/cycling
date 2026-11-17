import { useMemo } from 'react';
import { challengeById, fmtDur, totalDurationSec, trainingStress, type Challenge } from '../game/challenges';
import { coachNotes, suggestToday, swapsFor, trainingLoad, type SuggestionKind } from '../game/coach';
import { BONUS_FACTOR } from '../game/rewards';
import { todayBonusClaimed, todayBonusId, useGame } from '../store/gameStore';
import { FtpNudge } from './CoachNotes';
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
  const { rides, ftpHistory, completed, ftp, plan, coach } = profile;
  const suggestion = useMemo(() => suggestToday({ ftp, ftpHistory, completed, rides, plan, coach }), [ftp, ftpHistory, completed, rides, plan, coach]);
  const load = useMemo(() => trainingLoad(rides), [rides]);
  // A trend the suggestion didn't already act on, shown as a one-line note.
  const note = useMemo(() => (suggestion.insight ? undefined : coachNotes({ ftp, ftpHistory, completed, rides, coach })[0]), [suggestion, ftp, ftpHistory, completed, rides, coach]);
  // Re-mount (resetting any swaps) when the suggestion itself changes, e.g. after a ride.
  return <TodayInner key={suggestion.workout.id + suggestion.kind} suggestion={suggestion} load={load} note={note} />;
}

function TodayInner({ suggestion, load, note }: { suggestion: ReturnType<typeof suggestToday>; load: ReturnType<typeof trainingLoad>; note?: ReturnType<typeof coachNotes>[number] }) {
  const { conn, run, ride, startChallenge, startRide, setScreen, todayPick, setTodayPick, profile } = useGame();
  const chosenId = todayPick?.suggestionId === suggestion.workout.id ? todayPick.workoutId : null;
  const setChosenId = (id: string | null) => setTodayPick(id ? { suggestionId: suggestion.workout.id, workoutId: id } : null);
  const workout: Challenge = (chosenId && challengeById(chosenId)) || suggestion.workout;
  const swapped = workout.id !== suggestion.workout.id;
  const swaps = swapsFor(workout);
  const connected = conn === 'connected';
  const tss = workout.workout?.tss ?? trainingStress(workout.steps);
  const bonus = todayBonusId(profile, todayPick) === workout.id;
  const claimed = todayBonusClaimed(profile);
  const xp = bonus ? Math.round(workout.xpReward * BONUS_FACTOR) : workout.xpReward;

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
        {bonus && (
          <span className="pill bonus" title="Ride today's suggestion (or a swap of it) for bonus XP, once a day">
            ★ ×{BONUS_FACTOR} XP today
          </span>
        )}
        {claimed && <span className="pill done">✓ Bonus earned</span>}
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
      {suggestion.insight && <FtpNudge insight={suggestion.insight} />}
      {note && (
        <p className="coach-note muted small" title={note.text}>
          🧭 {note.text}
        </p>
      )}
      {note && <FtpNudge insight={note} />}
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
          <span className="xp">+{xp} XP</span>
        </div>
      </div>

      <div className="today-actions">
        <div className="today-start">
          <button className="btn primary big" disabled={!connected || !!run} onClick={() => startChallenge(workout.id)}>
            {run ? 'Ride in progress' : `Start ${workout.name}`}
          </button>
          <button
            className="btn big"
            disabled={!connected}
            title="Ride without a workout, shifting virtual gears"
            onClick={() => {
              if (!ride) startRide();
              setScreen('ride');
            }}
          >
            🚴 {ride ? 'Back to ride' : 'Free ride'}
          </button>
        </div>
        <div className="swap-row">
          {swapBtn('Shorter', swaps.shorter)}
          {swapBtn('Easier', swaps.easier)}
          {swapBtn('Harder', swaps.harder)}
          <button className="link small" onClick={() => setScreen('challenges')}>
            All workouts →
          </button>
        </div>
      </div>
    </section>
  );
}
