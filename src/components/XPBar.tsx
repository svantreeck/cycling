import { xpToNext, type LevelState } from '../game/xp';

export function XPBar({ levels, compact = false }: { levels: LevelState; compact?: boolean }) {
  const need = xpToNext(levels.level);
  const pct = Math.min(100, (levels.xp / need) * 100);
  return (
    <div className={`xpbar ${compact ? 'compact' : ''}`}>
      <div className="xpbar-head">
        <span className="xpbar-level">LV {levels.level}</span>
        <span className="xpbar-nums">
          {Math.floor(levels.xp).toLocaleString()} / {need.toLocaleString()} XP
        </span>
      </div>
      <div className="xpbar-track">
        <div className="xpbar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
