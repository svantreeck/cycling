export type CosmeticLayer =
  | 'helmet'
  | 'teamKit'
  | 'aeroHelmet'
  | 'deepWheels'
  | 'polkaDot'
  | 'sunglasses'
  | 'ttBike'
  | 'speedLines'
  | 'goldTrim'
  | 'aura'
  | 'flames'
  | 'wings'
  | 'sparkle';

export interface AvatarTier {
  minLevel: number;
  title: string;
  unlocks: CosmeticLayer[];
  /** kit colours unlocked at this tier */
  kitColors: string[];
  blurb: string;
}

export const AVATAR_TIERS: AvatarTier[] = [
  { minLevel: 1, title: 'Rookie', unlocks: [], kitColors: ['#95a5a6'], blurb: 'A basic bike and a plain kit. You have to start somewhere.' },
  { minLevel: 5, title: 'Domestique', unlocks: ['helmet', 'teamKit'], kitColors: ['#2980b9', '#27ae60'], blurb: 'Team colours and a proper helmet.' },
  { minLevel: 10, title: 'Rouleur', unlocks: ['aeroHelmet', 'deepWheels'], kitColors: ['#c0392b', '#16a085'], blurb: 'Aero helmet and deep-section carbon wheels.' },
  { minLevel: 15, title: 'Climber', unlocks: ['polkaDot', 'sunglasses'], kitColors: ['#ffffff'], blurb: 'Polka-dot kit and shades.' },
  { minLevel: 20, title: 'Sprinter', unlocks: ['ttBike', 'speedLines'], kitColors: ['#2ecc71', '#8e44ad'], blurb: 'Carbon TT bike with a disc wheel.' },
  { minLevel: 30, title: 'Champion', unlocks: ['goldTrim', 'aura'], kitColors: ['#f1c40f'], blurb: 'Gold trim and a glowing aura.' },
  { minLevel: 40, title: 'Legend', unlocks: ['flames', 'wings', 'sparkle'], kitColors: ['#e74c3c', '#111111'], blurb: 'Flame trail, wings and sparkles.' },
];

export function tierFor(level: number): AvatarTier {
  let t = AVATAR_TIERS[0];
  for (const tier of AVATAR_TIERS) if (level >= tier.minLevel) t = tier;
  return t;
}

export function nextTier(level: number): AvatarTier | undefined {
  return AVATAR_TIERS.find((t) => t.minLevel > level);
}

export function unlockedLayers(level: number): Set<CosmeticLayer> {
  const out = new Set<CosmeticLayer>();
  for (const t of AVATAR_TIERS) if (level >= t.minLevel) t.unlocks.forEach((u) => out.add(u));
  return out;
}

export function unlockedKitColors(level: number): string[] {
  return AVATAR_TIERS.filter((t) => level >= t.minLevel).flatMap((t) => t.kitColors);
}

/** Tiers newly reached when going from `from` to `to`. */
export function tiersReached(from: number, to: number): AvatarTier[] {
  return AVATAR_TIERS.filter((t) => t.minLevel > from && t.minLevel <= to);
}
