import { useMemo } from 'react';
import { fmtDur, totalDurationSec } from '../game/challenges';
import { coachNotes, suggestToday, type Feel } from '../game/coach';
import { rideFeel, type Insight } from '../game/insights';
import type { RideSummary } from '../store/persistence';
import { useGame } from '../store/gameStore';

/** Rides shorter than this don't get a check-in: too short to say much about how training is going. */
const CHECKIN_MIN_SEC = 20 * 60;

const FEELS: [Feel, string][] = [
  ['easy', '😌 Easy'],
  ['right', '👌 Just right'],
  ['hard', '🥵 Really hard'],
];

/** "How did that ride feel?" on the ride summary, unless a workout check-in during the ride already answered it. */
export function RideCheckIn({ ride }: { ride: RideSummary }) {
  const rateRide = useGame((s) => s.rateRide);
  const answered = rideFeel(ride);
  if (ride.durationSec < CHECKIN_MIN_SEC) return null;
  if (answered && !ride.feel) return null; // rated in the workout's own check-in
  return (
    <div className="checkin">
      <div className="checkin-q">How did that ride feel?</div>
      <div className="checkin-opts">
        {FEELS.map(([f, label]) => (
          <button key={f} className={`chip ${ride.feel === f ? 'active' : ''}`} onClick={() => rateRide(f)}>
            {label}
          </button>
        ))}
      </div>
      {ride.feel && <div className="muted small">Noted. The coach looks for patterns across your rides, not just this one.</div>}
    </div>
  );
}

/** One-tap answers to the coach's "your FTP looks low" note. */
export function FtpNudge({ insight }: { insight: Insight }) {
  const { raiseFtp, dismissFtpNudge, profile } = useGame();
  if (insight.raiseFtpTo == null) return null;
  return (
    <div className="coach-actions">
      <button className="chip small" onClick={() => raiseFtp(insight.raiseFtpTo!)} title={`Set FTP to ${insight.raiseFtpTo} W without a test`}>
        Raise FTP {profile.ftp} → {insight.raiseFtpTo} W
      </button>
      <button className="link small" onClick={dismissFtpNudge}>
        Not now
      </button>
    </div>
  );
}

/** After a ride: what the coach sees in the rider's recent trends, and what it suggests next. */
export function CoachNotesCard() {
  const profile = useGame((s) => s.profile);
  const { notes, next } = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(12, 0, 0, 0);
    return { notes: coachNotes(profile), next: suggestToday(profile, tomorrow.getTime()) };
  }, [profile]);
  const ftpLow = notes.find((n) => n.id === 'ftp-low');
  return (
    <div className="coach-notes">
      <h4>Coach's notes</h4>
      {notes.length ? (
        <ul>
          {notes.slice(0, 3).map((n) => (
            <li key={n.id}>{n.text}</li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No patterns yet. The coach compares several rides before forming an opinion.</p>
      )}
      {ftpLow && <FtpNudge insight={ftpLow} />}
      <p className="coach-next">
        <strong>Next ride:</strong> {next.workout.name} ({fmtDur(totalDurationSec(next.workout))}). {next.reason}
      </p>
    </div>
  );
}
