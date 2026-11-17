import { useEffect, useMemo, useState } from 'react';
import type { ControllerAction } from './ble/controller';
import { ChallengeBoard } from './components/ChallengeBoard';
import { Avatar, type Mood } from './components/Avatar';
import { trainingLoad, type TrainingLoad } from './game/coach';
import { ConnectionChip, ConnectPanel, MockControllerPad, SimControls } from './components/ConnectPanel';
import { CelebrationModal } from './components/LevelUpModal';
import { ProfileScreen } from './components/Profile';
import { StatsPanel } from './components/StatsPanel';
import { TodayCard } from './components/TodayCard';
import { WeekCard } from './components/WeekCard';
import { RideScreen } from './components/RideHUD';
import { XPBar } from './components/XPBar';
import { tierFor } from './game/avatarTiers';
import { roman } from './game/challenges';
import { useGame, type Screen } from './store/gameStore';

const TABS: { id: Screen; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'ride', label: 'Ride' },
  { id: 'challenges', label: 'Train' },
  { id: 'profile', label: 'Profile' },
];

/** Keyboard shortcuts mirror the controller buttons. */
const KEY_ACTIONS: Record<string, ControllerAction> = {
  '=': 'shiftUp',
  '+': 'shiftUp',
  '-': 'shiftDown',
  _: 'shiftDown',
  ']': 'harder',
  '[': 'easier',
  n: 'skip',
  p: 'pause',
};

function useControllerKeys() {
  const controllerAction = useGame((s) => s.controllerAction);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      const action = KEY_ACTIONS[e.key];
      if (!action) return;
      e.preventDefault();
      controllerAction(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controllerAction]);
}

function ActionToast() {
  const toast = useGame((s) => s.toast);
  if (!toast) return null;
  return (
    <div key={toast.id} className="action-toast">
      {toast.text}
    </div>
  );
}

export default function App() {
  useControllerKeys();
  // Reconnect the trainer and shifters from last time, where the browser allows it without a prompt.
  useEffect(() => {
    void useGame.getState().autoConnect();
  }, []);
  const { screen, setScreen, error, clearError, profile, ride, run } = useGame();
  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">⚡ Cycling Quest</div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${screen === t.id ? 'active' : ''}`} onClick={() => setScreen(t.id)}>
              {t.label}
              {t.id === 'ride' && (ride || run) && <span className="live-dot" />}
            </button>
          ))}
        </nav>
        <ConnectionChip />
      </header>

      {error && (
        <div className="toast error" onClick={clearError}>
          {error} <span className="muted">(dismiss)</span>
        </div>
      )}

      <main>
        {screen === 'home' && <Home />}
        {screen === 'ride' && <RideScreen />}
        {screen === 'challenges' && <ChallengeBoard />}
        {screen === 'profile' && <ProfileScreen />}
      </main>

      <CelebrationModal />
      <ActionToast />
      {!profile.settings.onboarded && <Onboarding />}
    </div>
  );
}

/** Avatar mood and label for each form state. */
const MOOD: Record<TrainingLoad['formLabel'], { mood: Mood; label: string }> = {
  Fresh: { mood: 'fresh', label: '😄 Fresh and ready' },
  Neutral: { mood: 'neutral', label: '🙂 Feeling good' },
  Building: { mood: 'tired', label: '😅 Tired, building fitness' },
  Overreaching: { mood: 'exhausted', label: '🥵 Exhausted: time to rest' },
};

function Home() {
  const { profile } = useGame();
  const tier = tierFor(profile.levels.level);
  const load = useMemo(() => trainingLoad(profile.rides), [profile.rides]);

  // Two columns on wide screens (iPad landscape, laptops) so everything fits without scrolling.
  return (
    <div className="home">
      <div className="home-grid">
        <div className="home-col">
          <section className="hero card">
            <div className="hero-avatar">
              <Avatar level={profile.levels.level} kitColor={profile.cosmetics.kitColor} idleSpin width={210} mood={MOOD[load.formLabel].mood} />
              <span className="pill mood-pill" title={`Form ${load.form}: fitness minus fatigue from your recent rides.`}>
                {MOOD[load.formLabel].label}
              </span>
            </div>
            <div className="hero-id">
              <div className="hero-name">{profile.name}</div>
              <div className="hero-title">{tier.title}</div>
              <div className="hero-stats">
                <span>FTP <strong>{profile.ftp} W</strong></span>
                {profile.promotions.length > 0 && (
                  <span title={`${profile.promotions.length} training blocks completed`}>
                    Rank <strong>{roman(profile.promotions.length)}</strong>
                  </span>
                )}
                <span>Rides <strong>{profile.rides.length}</strong></span>
              </div>
            </div>
            <div className="hero-xp">
              <XPBar levels={profile.levels} />
            </div>
            <div className="hero-sys">
              <StatsPanel compact />
            </div>
          </section>
          <WeekCard />
        </div>
        <div className="home-col">
          <ConnectPanel />
          <TodayCard />
        </div>
      </div>
      <SimControls />
      <MockControllerPad />
    </div>
  );
}

function Onboarding() {
  const { profile, updateProfile } = useGame();
  const [name, setName] = useState(profile.name === 'Rider' ? '' : profile.name);
  const [ftp, setFtp] = useState('');
  const ftpNum = Math.round(+ftp);
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>Welcome to Cycling Quest ⚡</h2>
        <p>
          You earn XP for every minute you ride, and more in harder zones. Set a goal and the coach suggests a ride each
          day. Train in 4-week blocks and pass the FTP retest at the end of each one to get promoted. Your avatar gets new gear
          as you level up.
        </p>
        <label>
          Rider name
          <input autoFocus value={name} placeholder="Rider" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          FTP (watts)
          <input type="number" value={ftp} placeholder="200" onChange={(e) => setFtp(e.target.value)} />
          <span className="muted small">Don't know it? Leave it blank (200 W is used) and take the Ramp Test first.</span>
        </label>
        <button
          className="btn primary"
          onClick={() =>
            updateProfile({
              name: name.trim() || 'Rider',
              ftp: ftpNum >= 50 && ftpNum <= 600 ? ftpNum : 200,
              settings: { ...profile.settings, onboarded: true },
            })
          }
        >
          Let's ride
        </button>
      </div>
    </div>
  );
}
