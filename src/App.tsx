import { useState } from 'react';
import { ChallengeBoard } from './components/ChallengeBoard';
import { Avatar } from './components/Avatar';
import { ConnectionChip, ConnectPanel, SimControls } from './components/ConnectPanel';
import { CelebrationModal } from './components/LevelUpModal';
import { ProfileScreen } from './components/Profile';
import { StatsPanel } from './components/StatsPanel';
import { TodayCard } from './components/TodayCard';
import { WeekCard } from './components/WeekCard';
import { RideScreen } from './components/RideHUD';
import { XPBar } from './components/XPBar';
import { nextTier, tierFor } from './game/avatarTiers';
import { fmtDur, roman, totalDurationSec } from './game/challenges';
import { activeBounty, useGame, type Screen } from './store/gameStore';

const TABS: { id: Screen; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'ride', label: 'Ride' },
  { id: 'challenges', label: 'Train' },
  { id: 'profile', label: 'Profile' },
];

export default function App() {
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
      {!profile.settings.onboarded && <Onboarding />}
    </div>
  );
}

function Home() {
  const { profile, conn, setScreen, startRide, startChallenge, ride } = useGame();
  const tier = tierFor(profile.levels.level);
  const next = nextTier(profile.levels.level);
  const bounty = activeBounty(profile);
  const connected = conn === 'connected';
  const lastRide = profile.rides[profile.rides.length - 1];

  return (
    <div className="home">
      <section className="hero card">
        <Avatar level={profile.levels.level} kitColor={profile.cosmetics.kitColor} idleSpin width={360} />
        <div className="hero-info">
          <div className="hero-name">{profile.name}</div>
          <div className="hero-title">{tier.title}</div>
          <XPBar levels={profile.levels} />
          <StatsPanel compact />
          <div className="hero-stats">
            <span>FTP <strong>{profile.ftp} W</strong></span>
            {profile.promotions.length > 0 && (
              <span title={`${profile.promotions.length} training blocks completed`}>
                Rank <strong>{roman(profile.promotions.length)}</strong>
              </span>
            )}
            <span>Rides <strong>{profile.rides.length}</strong></span>
            <span>Challenges <strong>{Object.values(profile.completed).reduce((a, r) => a + r.count, 0)}</strong></span>
          </div>
          {next && (
            <div className="muted small">
              Next look: <strong>{next.title}</strong> at level {next.minLevel}. {next.blurb}
            </div>
          )}
        </div>
      </section>

      <ConnectPanel />

      <TodayCard />
      <WeekCard />

      <div className="home-actions">
        <button
          className="btn primary big"
          disabled={!connected}
          onClick={() => {
            if (!ride) startRide();
            setScreen('ride');
          }}
        >
          🚴 {ride ? 'Back to ride' : 'Free ride'}
        </button>
        <button className="btn big" onClick={() => setScreen('challenges')}>
          ⚡ Workouts & challenges
        </button>
      </div>

      {bounty && (
        <div className="card bounty">
          <div className="pill gold">★ Today's bounty, ×1.5 XP</div>
          <h3>{bounty.name}</h3>
          <p className="muted">{bounty.description}</p>
          <div className="row">
            <span>⏱ {fmtDur(totalDurationSec(bounty))}</span>
            <button className="btn primary" disabled={!connected} onClick={() => startChallenge(bounty.id)}>
              Start bounty
            </button>
          </div>
        </div>
      )}

      {lastRide && (
        <div className="card muted small">
          Last ride: {new Date(lastRide.startedAt).toLocaleString()} · {fmtDur(lastRide.durationSec)} · {lastRide.avgPower} W avg · +
          {lastRide.xpEarned} XP
        </div>
      )}
      <SimControls />
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
