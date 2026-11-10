import { useEffect, useId, useRef, useState } from 'react';
import { unlockedLayers, type CosmeticLayer } from '../game/avatarTiers';

interface Props {
  level: number;
  kitColor: string;
  cadence?: number;
  speedKph?: number;
  /** pedal gently when idle (menus) */
  idleSpin?: boolean;
  width?: number;
  className?: string;
}

// Geometry (viewBox 0 0 320 220). Proportions follow a real road bike: wheelbase ≈ 2.75 × wheel
// radius, torso ≈ 58% of leg length, back ≈ 33° from horizontal (between racing ~20° and relaxed ~40°).
const WHEEL_R = 44;
const R = { x: 100, y: 150 };
const F = { x: 221, y: 150 };
const BB = { x: 153, y: 155 };
const ST_TOP = { x: 133, y: 105 }; // seat tube / top tube junction
const SADDLE = { x: 124, y: 79 };
const HEAD_TOP = { x: 206, y: 96 };
const HEAD_BOT = { x: 209, y: 110 };
const STEM = { x: 214, y: 92 };
const HIP = { x: 125, y: 73 };
const SHOULDER = { x: 175, y: 40 };
const HEAD = { x: 187, y: 27 };
const HAND = { x: 216, y: 92 }; // on the hoods
const CRANK = 16;
const THIGH = 52;
const SHIN = 51;
const UPPER_ARM = 35;
const FOREARM = 35;
const SKIN = '#f1c27d';

type Pt = { x: number; y: number };

/** Two-bone IK: joint position between `a` and `b`. bend = -1 bends left of a→b (knee forward), +1 right (elbow down). */
function joint(a: Pt, b: Pt, l1: number, l2: number, bend: 1 | -1): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 0.01);
  const ang = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const base = Math.atan2(dy, dx) + bend * ang;
  return { x: a.x + l1 * Math.cos(base), y: a.y + l1 * Math.sin(base) };
}

const knee = (hip: Pt, foot: Pt) => joint(hip, foot, THIGH, SHIN, -1);
const ELBOW = joint(SHOULDER, HAND, UPPER_ARM, FOREARM, 1);

const foot = (theta: number): Pt => ({ x: BB.x + CRANK * Math.cos(theta), y: BB.y + CRANK * Math.sin(theta) });

/** Drive crank + wheel angles from cadence/speed with requestAnimationFrame. */
function useSpin(cadence: number, speedKph: number) {
  const [angles, setAngles] = useState({ crank: 0, wheel: 0 });
  const ref = useRef({ cadence, speedKph });
  ref.current = { cadence, speedKph };
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { cadence: c, speedKph: v } = ref.current;
      if (c > 0 || v > 0) {
        setAngles((a) => ({
          crank: (a.crank + (c / 60) * 2 * Math.PI * dt) % (2 * Math.PI),
          wheel: (a.wheel + (v / 3.6 / 0.34) * dt * 0.25) % (2 * Math.PI), // slowed so spokes stay readable
        }));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return angles;
}

function Wheel({ c, angle, deep, disc, gold, u }: { c: Pt; angle: number; deep: boolean; disc: boolean; gold: boolean; u: string }) {
  const spokes = deep ? 6 : 12;
  return (
    <g>
      <circle cx={c.x} cy={c.y} r={WHEEL_R} fill="none" stroke="#1b1b1b" strokeWidth={5} />
      {disc ? (
        <>
          <circle cx={c.x} cy={c.y} r={WHEEL_R - 3} fill={`url(#${u}discGrad)`} />
          <g transform={`rotate(${(angle * 180) / Math.PI} ${c.x} ${c.y})`}>
            <path d={`M ${c.x - 20} ${c.y - 6} A 22 22 0 0 1 ${c.x + 12} ${c.y - 18}`} stroke="rgba(255,255,255,0.25)" strokeWidth={3} fill="none" />
          </g>
        </>
      ) : (
        <>
          {deep && <circle cx={c.x} cy={c.y} r={WHEEL_R - 6} fill="none" stroke={gold ? '#d4a017' : '#2d2d2d'} strokeWidth={9} />}
          <g transform={`rotate(${(angle * 180) / Math.PI} ${c.x} ${c.y})`}>
            {Array.from({ length: spokes }, (_, i) => {
              const a = (i / spokes) * Math.PI * 2;
              const r = deep ? WHEEL_R - 10 : WHEEL_R - 3;
              return (
                <line key={i} x1={c.x} y1={c.y} x2={c.x + r * Math.cos(a)} y2={c.y + r * Math.sin(a)} stroke="#8a8a8a" strokeWidth={1} />
              );
            })}
          </g>
        </>
      )}
      <circle cx={c.x} cy={c.y} r={3} fill="#555" />
    </g>
  );
}

function Leg({ theta, far, kitShorts }: { theta: number; far: boolean; kitShorts: string }) {
  const f = foot(theta);
  const k = knee(HIP, f);
  const shade = far ? 0.65 : 1;
  return (
    <g opacity={shade}>
      <line x1={HIP.x} y1={HIP.y} x2={k.x} y2={k.y} stroke={kitShorts} strokeWidth={12} strokeLinecap="round" />
      <line x1={k.x} y1={k.y} x2={f.x} y2={f.y} stroke={SKIN} strokeWidth={8} strokeLinecap="round" />
      <ellipse cx={f.x + 4} cy={f.y + 1} rx={8} ry={3.5} fill="#222" />
    </g>
  );
}

export function Avatar({ level, kitColor, cadence = 0, speedKph = 0, idleSpin = false, width = 320, className }: Props) {
  const layers = unlockedLayers(level);
  const has = (l: CosmeticLayer) => layers.has(l);
  const effCadence = cadence > 0 ? cadence : idleSpin ? 45 : 0;
  const effSpeed = speedKph > 0 ? speedKph : idleSpin ? 15 : 0;
  const { crank, wheel } = useSpin(effCadence, effSpeed);
  const u = useId().replace(/:/g, '');

  const gold = has('goldTrim');
  const frameColor = has('ttBike') ? '#1e1e1e' : '#b8c2cc';
  const frameAccent = gold ? `url(#${u}goldGrad)` : has('ttBike') ? '#444' : '#8795a1';
  const jersey = has('polkaDot') && kitColor.toLowerCase() === '#ffffff' ? `url(#${u}polka)` : kitColor;
  const shorts = '#1a1a1a';
  const moving = effSpeed > 0;
  const speedOpacity = Math.min(1, effSpeed / 35);

  return (
    <svg viewBox="0 -8 320 220" width={width} className={className} role="img" aria-label={`Level ${level} cyclist avatar`}>
      <defs>
        <radialGradient id={`${u}auraGrad`}>
          <stop offset="0%" stopColor={gold ? '#ffe680' : '#7fdbff'} stopOpacity={0.8} />
          <stop offset="100%" stopColor={gold ? '#ffb700' : '#0074d9'} stopOpacity={0} />
        </radialGradient>
        <linearGradient id={`${u}goldGrad`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff3b0" />
          <stop offset="50%" stopColor="#d4a017" />
          <stop offset="100%" stopColor="#8a6d0b" />
        </linearGradient>
        <radialGradient id={`${u}discGrad`} cx="40%" cy="35%">
          <stop offset="0%" stopColor="#555" />
          <stop offset="100%" stopColor="#111" />
        </radialGradient>
        <linearGradient id={`${u}flameGrad`} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0%" stopColor="#fff176" />
          <stop offset="40%" stopColor="#ff9800" />
          <stop offset="100%" stopColor="#e53935" stopOpacity={0} />
        </linearGradient>
        <linearGradient id={`${u}wingGrad`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#cfe8ff" />
        </linearGradient>
        <pattern id={`${u}polka`} width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="#ffffff" />
          <circle cx="4" cy="4" r="2.2" fill="#e53935" />
        </pattern>
      </defs>

      {/* ground */}
      <line x1="0" y1={R.y + WHEEL_R + 2} x2="320" y2={R.y + WHEEL_R + 2} stroke="rgba(255,255,255,0.12)" strokeWidth={2} />

      {has('aura') && <ellipse className="av-aura" cx={160} cy={108} rx={150} ry={98} fill={`url(#${u}auraGrad)`} />}

      {has('flames') && moving && (
        <g transform="translate(14 0)">
        <g className="av-flames" opacity={0.4 + 0.6 * speedOpacity}>
          <path d="M 45 150 C 25 135, 10 150, -10 138 C 10 155, 20 160, -5 172 C 20 170, 35 168, 45 162 Z" fill={`url(#${u}flameGrad)`} />
          <path d="M 45 128 C 30 118, 20 126, 5 118 C 18 132, 25 136, 10 146 C 28 142, 38 140, 47 136 Z" fill={`url(#${u}flameGrad)`} opacity={0.8} />
        </g>
        </g>
      )}

      {has('speedLines') && moving && (
        <g className="av-speedlines" stroke="rgba(255,255,255,0.6)" strokeWidth={2} strokeLinecap="round" opacity={speedOpacity}>
          <line x1="10" y1="70" x2="60" y2="70" />
          <line x1="0" y1="95" x2="45" y2="95" />
          <line x1="15" y1="120" x2="50" y2="120" />
        </g>
      )}

      {has('wings') && (
        <g transform="translate(160 50) scale(0.85) translate(-175 -66)">
          <g className="av-wings">
            <path d="M 175 66 C 150 20, 110 10, 80 18 C 105 28, 120 40, 128 52 C 112 46, 98 46, 88 50 C 110 58, 130 66, 150 74 Z" fill={`url(#${u}wingGrad)`} stroke="#9cc9f0" strokeWidth={1} opacity={0.9} />
          </g>
        </g>
      )}

      {/* far leg behind bike */}
      <Leg theta={crank + Math.PI} far kitShorts={shorts} />
      <line x1={BB.x} y1={BB.y} x2={foot(crank + Math.PI).x} y2={foot(crank + Math.PI).y} stroke="#333" strokeWidth={3} />

      <Wheel c={R} angle={wheel} deep={has('deepWheels') || has('ttBike')} disc={has('ttBike')} gold={gold} u={u} />
      <Wheel c={F} angle={wheel} deep={has('deepWheels') || has('ttBike')} disc={false} gold={gold} u={u} />

      {/* frame */}
      <g stroke={frameColor} strokeWidth={has('ttBike') ? 6 : 4.5} strokeLinecap="round" fill="none">
        <line x1={BB.x} y1={BB.y} x2={ST_TOP.x} y2={ST_TOP.y} />
        <line x1={ST_TOP.x} y1={ST_TOP.y} x2={HEAD_TOP.x} y2={HEAD_TOP.y} />
        <line x1={BB.x} y1={BB.y} x2={HEAD_BOT.x} y2={HEAD_BOT.y} />
        <line x1={HEAD_TOP.x} y1={HEAD_TOP.y} x2={HEAD_BOT.x} y2={HEAD_BOT.y} />
        <line x1={HEAD_BOT.x} y1={HEAD_BOT.y} x2={F.x} y2={F.y} />
        <line x1={BB.x} y1={BB.y} x2={R.x} y2={R.y} />
        <line x1={ST_TOP.x} y1={ST_TOP.y + 2} x2={R.x} y2={R.y} />
      </g>
      <g stroke={frameAccent} strokeWidth={1.5} fill="none" strokeLinecap="round">
        <line x1={BB.x} y1={BB.y - 3} x2={HEAD_BOT.x} y2={HEAD_BOT.y - 3} />
      </g>
      {/* saddle, stem, bars */}
      <line x1={ST_TOP.x} y1={ST_TOP.y} x2={SADDLE.x + 2} y2={SADDLE.y + 2} stroke="#555" strokeWidth={3} strokeLinecap="round" />
      <path d={`M ${SADDLE.x - 12} ${SADDLE.y - 1} L ${SADDLE.x + 12} ${SADDLE.y + 1}`} stroke="#111" strokeWidth={5} strokeLinecap="round" />
      <line x1={HEAD_TOP.x} y1={HEAD_TOP.y} x2={STEM.x} y2={STEM.y} stroke="#333" strokeWidth={4} strokeLinecap="round" />
      <path d={`M ${STEM.x} ${STEM.y} q 9 -1 9 7 q 0 8 -6 10`} stroke="#222" strokeWidth={3.5} fill="none" strokeLinecap="round" />
      {has('ttBike') && <line x1={STEM.x - 2} y1={STEM.y - 3} x2={STEM.x + 18} y2={STEM.y - 5} stroke="#222" strokeWidth={3} strokeLinecap="round" />}
      {/* chainring */}
      <circle cx={BB.x} cy={BB.y} r={10} fill="none" stroke={gold ? `url(#${u}goldGrad)` : '#666'} strokeWidth={2.5} />

      {/* rider torso */}
      <line x1={HIP.x} y1={HIP.y} x2={SHOULDER.x} y2={SHOULDER.y} stroke={jersey} strokeWidth={16} strokeLinecap="round" />
      {has('teamKit') && !has('polkaDot') && (
        <line x1={HIP.x + 4} y1={HIP.y - 3} x2={SHOULDER.x - 2} y2={SHOULDER.y - 3} stroke="rgba(255,255,255,0.7)" strokeWidth={3} strokeLinecap="round" />
      )}
      {gold && <line x1={HIP.x + 6} y1={HIP.y + 5} x2={SHOULDER.x} y2={SHOULDER.y + 6} stroke={`url(#${u}goldGrad)`} strokeWidth={2.5} strokeLinecap="round" />}

      {/* near leg + crank */}
      <Leg theta={crank} far={false} kitShorts={shorts} />
      <line x1={BB.x} y1={BB.y} x2={foot(crank).x} y2={foot(crank).y} stroke="#444" strokeWidth={3.5} strokeLinecap="round" />

      {/* arm */}
      <line x1={SHOULDER.x} y1={SHOULDER.y} x2={ELBOW.x} y2={ELBOW.y} stroke={jersey} strokeWidth={8} strokeLinecap="round" />
      <line x1={ELBOW.x} y1={ELBOW.y} x2={HAND.x} y2={HAND.y} stroke={SKIN} strokeWidth={6} strokeLinecap="round" />

      {/* head */}
      <line x1={SHOULDER.x + 2} y1={SHOULDER.y - 2} x2={HEAD.x - 4} y2={HEAD.y + 6} stroke={SKIN} strokeWidth={7} strokeLinecap="round" />
      <circle cx={HEAD.x} cy={HEAD.y} r={11} fill={SKIN} />
      {has('aeroHelmet') ? (
        <path
          d={`M ${HEAD.x + 11} ${HEAD.y - 1} C ${HEAD.x + 10} ${HEAD.y - 16}, ${HEAD.x - 8} ${HEAD.y - 18}, ${HEAD.x - 16} ${HEAD.y - 8} L ${HEAD.x - 32} ${HEAD.y + 2} L ${HEAD.x - 10} ${HEAD.y + 2} Z`}
          fill={gold ? `url(#${u}goldGrad)` : kitColor === '#ffffff' ? '#e53935' : kitColor}
          stroke="#111"
          strokeWidth={1}
        />
      ) : has('helmet') ? (
        <path
          d={`M ${HEAD.x + 12} ${HEAD.y - 1} C ${HEAD.x + 10} ${HEAD.y - 17}, ${HEAD.x - 12} ${HEAD.y - 17}, ${HEAD.x - 13} ${HEAD.y + 1} Z`}
          fill={gold ? `url(#${u}goldGrad)` : '#f5f5f5'}
          stroke="#333"
          strokeWidth={1}
        />
      ) : (
        <path d={`M ${HEAD.x + 9} ${HEAD.y - 6} C ${HEAD.x + 4} ${HEAD.y - 14}, ${HEAD.x - 10} ${HEAD.y - 12}, ${HEAD.x - 11} ${HEAD.y - 2}`} fill="#5d4037" />
      )}
      {has('sunglasses') ? (
        <rect x={HEAD.x + 3} y={HEAD.y - 3} width={9} height={4} rx={2} fill="#111" />
      ) : (
        <circle cx={HEAD.x + 7} cy={HEAD.y - 1} r={1.3} fill="#222" />
      )}

      {has('sparkle') && (
        <g className="av-sparkle" fill="#fffde7">
          {[
            [40, 40], [280, 30], [300, 120], [20, 110], [140, 12],
          ].map(([x, y], i) => (
            <path key={i} style={{ animationDelay: `${i * 0.37}s` }} d={`M ${x} ${y - 6} L ${x + 1.5} ${y - 1.5} L ${x + 6} ${y} L ${x + 1.5} ${y + 1.5} L ${x} ${y + 6} L ${x - 1.5} ${y + 1.5} L ${x - 6} ${y} L ${x - 1.5} ${y - 1.5} Z`} />
          ))}
        </g>
      )}
    </svg>
  );
}
