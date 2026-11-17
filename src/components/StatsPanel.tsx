import { SYSTEM_INFO, SYSTEMS, statLevel } from '../game/stats';
import { useGame } from '../store/gameStore';

/** RPG-style fitness stats: one bar per system with its level and progress to the next. */
export function StatsPanel({ compact }: { compact?: boolean }) {
  const stats = useGame((s) => s.profile.stats);
  return (
    <div className={`stats ${compact ? 'compact' : ''}`}>
      {SYSTEMS.map((sys) => {
        const info = SYSTEM_INFO[sys];
        const { level, into, need } = statLevel(stats[sys]);
        return (
          <div key={sys} className="stat" title={`${info.blurb} ${Math.floor(into)}/${need} to level ${level + 1}.`}>
            <span className="stat-name">
              {info.icon} {info.name}
            </span>
            <span className="stat-lv">Lv {level}</span>
            <div className="stat-track">
              <div className="stat-fill" style={{ width: `${(into / need) * 100}%`, background: info.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
