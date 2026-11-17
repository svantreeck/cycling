import { useEffect } from 'react';
import { roman } from '../game/challenges';
import { SYSTEM_INFO } from '../game/stats';
import { useGame } from '../store/gameStore';
import { Avatar } from './Avatar';

/** Mid-ride celebrations close themselves after this long, so they don't cover the ride. */
export const RIDE_AUTO_DISMISS_MS = 5000;

export function CelebrationModal() {
  const { celebrations, dismissCelebration, profile, ride } = useGame();
  const c = celebrations[0];
  const auto = !!c && !!ride;

  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(dismissCelebration, RIDE_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [c, auto, dismissCelebration]);

  if (!c) return null;
  // Shrinking bar under the button while a mid-ride celebration counts down (re-keyed per celebration).
  const countdown = auto ? <div key={celebrations.length} className="auto-dismiss" style={{ animationDuration: `${RIDE_AUTO_DISMISS_MS}ms` }} /> : null;

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
          {countdown}
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
          {countdown}
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
        {countdown}
      </div>
    </div>
  );
}
