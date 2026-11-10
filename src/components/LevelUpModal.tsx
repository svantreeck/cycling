import { promotionChallenge } from '../game/challenges';
import { useGame } from '../store/gameStore';
import { Avatar } from './Avatar';

export function CelebrationModal() {
  const { celebrations, dismissCelebration, profile, setScreen } = useGame();
  const c = celebrations[0];
  if (!c) return null;

  if (c.kind === 'gate') {
    const promo = promotionChallenge(c.level);
    return (
      <div className="modal-backdrop">
        <div className="modal gate">
          <div className="big-emoji">🚧</div>
          <h2>Level cap reached</h2>
          <p>
            You need to pass <strong>{promo.name}</strong> to get past level {c.level}. XP you earn until then is banked and added
            once you're promoted.
          </p>
          <p className="muted">{promo.description}</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={dismissCelebration}>
              Later
            </button>
            <button
              className="btn primary"
              onClick={() => {
                dismissCelebration();
                setScreen('challenges');
              }}
            >
              See challenge
            </button>
          </div>
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
