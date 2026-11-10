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
