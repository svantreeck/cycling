import { useState } from 'react';
import { DEFAULT_MINUTES_BY_DAY, GOALS, hardPerWeek, weeklyTargetTss, type GoalId, type TrainingPlan } from '../game/coach';
import { localDate, useGame } from '../store/gameStore';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Monday-first display order (indexes into minutesByDay, which starts on Sunday). */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const MINUTE_OPTIONS = [0, 30, 45, 60, 75, 90, 120];
const GOAL_ICON: Record<GoalId, string> = { fitness: '💪', base: '🫁', ftp: '📈', event: '🏁' };

export function PlanSetup({ onClose }: { onClose: () => void }) {
  const { profile, updateProfile } = useGame();
  const existing = profile.plan;
  const [goal, setGoal] = useState<GoalId>(existing?.goal ?? 'fitness');
  const [minutes, setMinutes] = useState<number[]>(existing?.minutesByDay ?? DEFAULT_MINUTES_BY_DAY);
  const [eventDate, setEventDate] = useState(existing?.eventDate ?? '');

  const draft: TrainingPlan = { goal, minutesByDay: minutes, eventDate: goal === 'event' ? eventDate : undefined, createdAt: existing?.createdAt ?? Date.now() };
  const ridingDays = minutes.filter((m) => m > 0).length;
  const hours = minutes.reduce((a, m) => a + m, 0) / 60;
  const eventOk = goal !== 'event' || (eventDate !== '' && eventDate > localDate());
  const valid = ridingDays > 0 && eventOk;

  const setDay = (i: number, m: number) => setMinutes((ms) => ms.map((x, j) => (j === i ? m : x)));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal plan-setup" onClick={(e) => e.stopPropagation()}>
        <h2>Your training plan</h2>
        <p className="muted">Pick a goal and tell the coach when you can ride. It will suggest a ride each day and adapt as you go.</p>

        <h3>Goal</h3>
        <div className="goal-grid">
          {(Object.keys(GOALS) as GoalId[]).map((g) => (
            <button key={g} className={`goal ${goal === g ? 'active' : ''}`} onClick={() => setGoal(g)}>
              <span className="goal-icon">{GOAL_ICON[g]}</span>
              <strong>{GOALS[g].name}</strong>
              <span className="muted small">{GOALS[g].blurb}</span>
            </button>
          ))}
        </div>
        {goal === 'event' && (
          <label>
            Event date
            <input type="date" value={eventDate} min={localDate()} onChange={(e) => setEventDate(e.target.value)} />
            {!eventOk && <span className="muted small">Choose a date in the future.</span>}
          </label>
        )}

        <h3>When can you ride?</h3>
        <div className="avail">
          {DAY_ORDER.map((i) => (
            <div key={i} className="avail-row">
              <span className="avail-day">{DAY_NAMES[i]}</span>
              <div className="avail-opts">
                {MINUTE_OPTIONS.map((m) => (
                  <button key={m} className={`chip small ${minutes[i] === m ? 'active' : ''}`} onClick={() => setDay(i, m)}>
                    {fmtMinutes(m)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="plan-summary">
          {ridingDays === 0 ? (
            'Pick at least one riding day.'
          ) : (
            <>
              {ridingDays} riding days · {hours.toFixed(hours % 1 ? 1 : 0)} h a week · {hardPerWeek(draft)} key workout{hardPerWeek(draft) > 1 ? 's' : ''} a week ·
              weekly goal <strong>{weeklyTargetTss(draft)} TSS</strong>
            </>
          )}
        </div>

        <div className="row">
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() => {
              updateProfile({ plan: draft });
              onClose();
            }}
          >
            Save plan
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          {existing && (
            <button
              className="btn danger"
              onClick={() => {
                updateProfile({ plan: undefined });
                onClose();
              }}
            >
              Remove plan
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtMinutes(m: number): string {
  if (m === 0) return 'Rest';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}
