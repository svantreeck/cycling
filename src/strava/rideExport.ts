import { challengeById } from '../game/challenges';
import type { RideSummary } from '../store/persistence';
import { buildTcx } from './tcx';
import { loadTrack } from './track';

/** Strava's manual upload page (works on free accounts). */
export const STRAVA_UPLOAD_URL = 'https://www.strava.com/upload/select';

/** Activity title: the main workout ridden, if any. */
export function rideTitle(r: RideSummary): string {
  const done = r.challenges.filter((c) => c.passed).map((c) => challengeById(c.id)?.name).filter(Boolean);
  return done.length ? `Cadence Quest: ${done.join(' + ')}` : 'Cadence Quest ride';
}

export function rideNotes(r: RideSummary): string {
  const parts = [`${r.avgPower} W avg`, `${r.kj} kJ`];
  if (r.tss != null) parts.push(`TSS ${r.tss}`);
  parts.push(`+${r.xpEarned} XP`);
  return `${parts.join(' · ')}. Ridden in Cadence Quest.`;
}

export const rideFileName = (r: RideSummary) => {
  const d = new Date(r.startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `cadence-quest-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.tcx`;
};

/** The ride as a TCX document, or null if its track wasn't kept (older rides, or pushed out by newer ones). */
export function rideTcx(r: RideSummary): string | null {
  const track = loadTrack(r.id);
  if (!track || !track.points.length) return null;
  return buildTcx(track, { kj: r.kj, notes: `${rideTitle(r)}. ${rideNotes(r)}` });
}

/**
 * Save the ride's TCX file. On touch devices (iPad) the share sheet is used where available, since a plain
 * download link may do nothing there; "Save to Files" then makes it uploadable.
 */
export async function exportRide(r: RideSummary): Promise<boolean> {
  const tcx = rideTcx(r);
  if (!tcx) return false;
  const name = rideFileName(r);
  const file = new File([tcx], name, { type: 'application/vnd.garmin.tcx+xml' });
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: rideTitle(r) });
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return true;
      // fall through to a download
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}
