import { useState } from 'react';
import type { RideSummary } from '../store/persistence';
import { exportRide, STRAVA_UPLOAD_URL } from '../strava/rideExport';
import { hasTrack } from '../strava/track';

/** "Export .tcx" plus a link to Strava's upload page. Renders nothing when the ride's track wasn't kept. */
export function RideExport({ ride, compact = false }: { ride: RideSummary; compact?: boolean }) {
  const [err, setErr] = useState<string | null>(null);
  if (!hasTrack(ride.id)) return compact ? <span className="muted small">–</span> : null;
  const run = async () => {
    setErr(null);
    try {
      if (!(await exportRide(ride))) setErr('This ride’s track is no longer stored.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  if (compact) {
    return (
      <button className="btn small" onClick={run} title="Download this ride as a .tcx file">
        .tcx
      </button>
    );
  }
  return (
    <div className="ride-export">
      <div className="row">
        <button className="btn" onClick={run}>
          Export .tcx
        </button>
        <a className="btn" href={STRAVA_UPLOAD_URL} target="_blank" rel="noreferrer">
          Upload on Strava ↗
        </a>
      </div>
      <span className="muted small">
        Save the file, then choose it on Strava’s upload page. Works with any Strava account, and with intervals.icu,
        TrainingPeaks and Garmin Connect too.
      </span>
      {err && <span className="small" style={{ color: '#ff8a8a' }}>{err}</span>}
    </div>
  );
}
