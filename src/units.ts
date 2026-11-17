import type { SpeedUnit } from './store/persistence';

const KM_PER_MILE = 1.609344;

export const speedLabel = (u: SpeedUnit) => (u === 'mph' ? 'mph' : 'km/h');

export function convertSpeed(kph: number, u: SpeedUnit): number {
  return u === 'mph' ? kph / KM_PER_MILE : kph;
}

export const distanceLabel = (u: SpeedUnit) => (u === 'mph' ? 'mi' : 'km');

export function convertDistance(metres: number, u: SpeedUnit): number {
  return u === 'mph' ? metres / 1000 / KM_PER_MILE : metres / 1000;
}
