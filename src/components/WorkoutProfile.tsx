import type { Step } from '../game/challenges';

/** Bar colour for a step, matching the power-zone colours in game/zones.ts. */
export const stepColor = (s: Step) => {
  if (s.kind === 'effort') return '#9b59b6';
  const p = s.targetPctFtp ?? 50;
  if (p >= 121) return '#e74c3c';
  if (p >= 106) return '#e67e22';
  if (p >= 91) return '#f1c40f';
  if (p >= 76) return '#2ecc71';
  if (p >= 56) return '#3498db';
  return '#7f8c8d';
};

/** Bar chart of a workout's steps: width = duration, height = intensity. Pass `cursorPct` to show progress. */
export function WorkoutProfile({ steps, currentIndex, cursorPct, small }: { steps: Step[]; currentIndex?: number; cursorPct?: number; small?: boolean }) {
  return (
    <div className={`timeline ${small ? 'small' : ''}`} title="Workout profile">
      {steps.map((s, i) => (
        <div
          key={i}
          className={`tl-step ${currentIndex == null || i === currentIndex ? 'current' : ''}`}
          style={{ flex: s.durationSec, height: `${Math.min(100, (s.kind === 'effort' ? 150 : s.targetPctFtp ?? 50) / 1.6)}%`, background: stepColor(s) }}
        />
      ))}
      {cursorPct != null && <div className="tl-cursor" style={{ left: `${cursorPct}%` }} />}
    </div>
  );
}
