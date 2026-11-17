import { roman } from '../game/challenges';
import { SYSTEM_INFO } from '../game/stats';
import { useGame } from '../store/gameStore';
import { Avatar } from './Avatar';

export function CelebrationModal() {
  const { celebrations, dismissCelebration, profile } = useGame();
  const c = celebrations[0];
  if (!c) return null;

  if (c.kind === 'promotion') {
    return (
      <div className="modal-backdrop">
        <div className="modal levelup promotion">
          <div className="big-emoji">🎖️</div>
          <div className="levelup-burst">PROMOTED!</div>
          <div className="levelup-num">Rank {roman(c.rank)}</div>
          <p>
            You completed training block {c.block} and passed your FTP retest.
            {c.newFtp !== c.oldFtp && (
              <>
                {' '}
                FTP {c.oldFtp} W → <strong>{c.newFtp} W</strong>.
              </>
            )}
          </p>
          <p className="muted">Your next block starts now, with targets set from your new FTP. +{c.xp} XP</p>
          <button className="btn primary" onClick={dismissCelebration}>
            Let's go!
          </button>
        </div>
      </div>
    );
  }

  if (c.kind === 'stat') {
    const info = SYSTEM_INFO[c.system];
    return (
      <div className="modal-backdrop">
        <div className="modal levelup stat-up">
          <div className="big-emoji">{info.icon}</div>
          <div className="levelup-burst" style={{ color: info.color }}>
            {info.name} up!
          </div>
          <div className="levelup-num">Lv {c.level}</div>
          <p className="muted">{info.blurb}</p>
          <button className="btn primary" onClick={dismissCelebration}>
            Nice!
          </button>
        </div>
      </div>
    );
  }

  const newLevel = c.levels[c.levels.length - 1];
  return (
    <div className="modal-backdrop">
      <div className="modal levelup">
        <div className="levelup-burst">LEVEL UP!</div>
        <div className="levelup-num">{newLevel}</div>
        <Avatar level={newLevel} kitColor={profile.cosmetics.kitColor} idleSpin width={300} />
        {c.tiers.map((t) => (
          <div key={t.title} className="tier-unlock">
            <div className="tier-title">New title: {t.title}</div>
            <div className="muted">{t.blurb}</div>
            {t.kitColors.length > 0 && (
              <div className="swatches">
                New kit colours:
                {t.kitColors.map((k) => (
                  <span key={k} className="swatch" style={{ background: k }} />
                ))}
              </div>
            )}
          </div>
        ))}
        <button className="btn primary" onClick={dismissCelebration}>
          Awesome!
        </button>
      </div>
    </div>
  );
}
