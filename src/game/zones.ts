/** Coggan power zones as fraction-of-FTP upper bounds. */
export interface Zone {
  id: number;
  name: string;
  /** exclusive upper bound as % of FTP (Infinity for the top zone) */
  maxPct: number;
  color: string;
  xpMultiplier: number;
}

export const ZONES: Zone[] = [
  { id: 1, name: 'Recovery', maxPct: 55, color: '#7f8c8d', xpMultiplier: 1.0 },
  { id: 2, name: 'Endurance', maxPct: 76, color: '#3498db', xpMultiplier: 1.2 },
  { id: 3, name: 'Tempo', maxPct: 91, color: '#2ecc71', xpMultiplier: 1.5 },
  { id: 4, name: 'Threshold', maxPct: 106, color: '#f1c40f', xpMultiplier: 2.0 },
  { id: 5, name: 'VO2 Max', maxPct: 121, color: '#e67e22', xpMultiplier: 2.5 },
  { id: 6, name: 'Anaerobic', maxPct: 151, color: '#e74c3c', xpMultiplier: 3.0 },
  { id: 7, name: 'Neuromuscular', maxPct: Infinity, color: '#9b59b6', xpMultiplier: 3.0 },
];

export function zoneFor(power: number, ftp: number): Zone {
  const pct = (power / Math.max(1, ftp)) * 100;
  return ZONES.find((z) => pct < z.maxPct) ?? ZONES[ZONES.length - 1];
}

/**
 * Five heart-rate zones as % of max heart rate, coloured like the matching power zones so Z1–Z2 read as calm and
 * only hard efforts turn orange.
 */
export interface HrZone {
  id: number;
  name: string;
  /** exclusive upper bound as % of max HR (Infinity for the top zone) */
  maxPct: number;
  color: string;
}

export const HR_ZONES: HrZone[] = [
  { id: 1, name: 'Recovery', maxPct: 60, color: ZONES[0].color },
  { id: 2, name: 'Endurance', maxPct: 70, color: ZONES[1].color },
  { id: 3, name: 'Tempo', maxPct: 80, color: ZONES[2].color },
  { id: 4, name: 'Threshold', maxPct: 90, color: ZONES[3].color },
  { id: 5, name: 'Max', maxPct: Infinity, color: ZONES[4].color },
];

/** Assumed max heart rate until a ride shows a higher one. */
export const DEFAULT_MAX_HR = 185;

/**
 * Max heart rate for zones, without asking the rider: the highest heart rate seen in a saved ride, but never below
 * DEFAULT_MAX_HR (a ride that never went all-out would otherwise make every zone look harder than it is).
 */
export const estimateMaxHr = (rides: { maxHr?: number }[]) => rides.reduce((m, r) => Math.max(m, r.maxHr ?? 0), DEFAULT_MAX_HR);

export function hrZoneFor(bpm: number, maxHr: number): HrZone {
  const pct = (bpm / Math.max(1, maxHr)) * 100;
  return HR_ZONES.find((z) => pct < z.maxPct) ?? HR_ZONES[HR_ZONES.length - 1];
}
