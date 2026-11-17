import type { Track } from './track';

/**
 * Garmin Training Center XML (TCX) for an indoor ride: one lap, no GPS, with power and speed in the
 * ActivityExtension. Strava, TrainingPeaks and intervals.icu all import it. Element order matters to strict
 * parsers, so it follows the schema.
 */
export function buildTcx(track: Track, opts: { kj: number; notes?: string }): string {
  const iso = (sec: number) => new Date(track.startedAt + sec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const pts = track.points;
  const last = pts[pts.length - 1];
  const totalSec = last ? last.sec : 0;
  const distance = last ? last.distanceM : 0;
  const maxSpeed = pts.reduce((m, p) => Math.max(m, p.speedKph / 3.6), 0);
  const pedalling = pts.filter((p) => p.cadence > 0);
  const avgCadence = pedalling.length ? Math.round(pedalling.reduce((a, p) => a + p.cadence, 0) / pedalling.length) : 0;
  // On a bike, burned kcal ≈ mechanical kJ (≈24% efficiency cancels the 4.184 kJ/kcal).
  const calories = Math.round(opts.kj);

  const trackpoints = pts
    .map(
      (p) =>
        `<Trackpoint><Time>${iso(p.sec)}</Time><DistanceMeters>${p.distanceM.toFixed(1)}</DistanceMeters>` +
        `<Cadence>${Math.min(254, p.cadence)}</Cadence>` +
        `<Extensions><ns3:TPX><ns3:Speed>${(p.speedKph / 3.6).toFixed(2)}</ns3:Speed><ns3:Watts>${p.power}</ns3:Watts></ns3:TPX></Extensions></Trackpoint>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities>
<Activity Sport="Biking">
<Id>${iso(0)}</Id>
<Lap StartTime="${iso(0)}">
<TotalTimeSeconds>${totalSec}</TotalTimeSeconds>
<DistanceMeters>${distance.toFixed(1)}</DistanceMeters>
<MaximumSpeed>${maxSpeed.toFixed(2)}</MaximumSpeed>
<Calories>${calories}</Calories>
<Intensity>Active</Intensity>
<Cadence>${Math.min(254, avgCadence)}</Cadence>
<TriggerMethod>Manual</TriggerMethod>
<Track>
${trackpoints}
</Track>
</Lap>${opts.notes ? `\n<Notes>${escapeXml(opts.notes)}</Notes>` : ''}
</Activity>
</Activities>
</TrainingCenterDatabase>
`;
}

export const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
