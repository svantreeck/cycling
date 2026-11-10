import { isBlockedAtGate, xpToNext, type LevelState } from '../game/xp';

export function XPBar({ levels, compact = false }: { levels: LevelState; compact?: boolean }) {
  const need = xpToNext(levels.level);
  const pct = Math.min(100, (levels.xp / need) * 100);
  const gated = isBlockedAtGate(levels);
  const capped = gated && levels.xp >= need;
  return (
    <div className={`xpbar ${compact ? 'compact' : ''}`}>
      <div className="xpbar-head">
        <span className="xpbar-level">LV {levels.level}</span>
        <span className="xpbar-nums">
          {Math.floor(levels.xp).toLocaleString()} / {need.toLocaleString()} XP
          {levels.bankedXp > 0 && <span className="banked"> · +{Math.floor(levels.bankedXp).toLocaleString()} banked</span>}
        </span>
      </div>
      <div className={`xpbar-track ${capped ? 'capped' : ''}`}>
        <div className="xpbar-fill" style={{ width: `${pct}%` }} />
        {gated && <div className="xpbar-gate" title="Promotion gate">🔒</div>}
      </div>
      {capped && !compact && (
        <div className="xpbar-note">Your XP is full for this level. Pass the Promotion Trial to keep levelling. XP you earn until then is banked.</div>
      )}
    </div>
  );
}
