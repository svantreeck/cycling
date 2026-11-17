import { useRef, useState } from 'react';
import { AVATAR_TIERS, unlockedKitColors } from '../game/avatarTiers';
import { useGame } from '../store/gameStore';
import { speedLabel } from '../units';
import { roman } from '../game/challenges';
import { GOALS } from '../game/coach';
import { Avatar } from './Avatar';
import { PlanSetup } from './PlanSetup';
import { StatsPanel } from './StatsPanel';
import { fmtClock, ZoneDistribution } from './RideHUD';
import { RideExport } from './RideExport';

export function ProfileScreen() {
  const { profile, updateProfile, exportJson, importJson, resetProfile } = useGame();
  const [ftpInput, setFtpInput] = useState(String(profile.ftp));
  const fileRef = useRef<HTMLInputElement>(null);
  const [editingPlan, setEditingPlan] = useState(false);
  const level = profile.levels.level;
  const colors = unlockedKitColors(level);

  const download = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cadence-quest-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="profile">
      <div className="card">
        <h3>Rider</h3>
        <label>
          Name
          <input value={profile.name} onChange={(e) => updateProfile({ name: e.target.value })} />
        </label>
        <label>
          FTP (watts)
          <div className="row">
            <input type="number" min={50} max={600} value={ftpInput} onChange={(e) => setFtpInput(e.target.value)} />
            <button
              className="btn"
              disabled={!(+ftpInput >= 50 && +ftpInput <= 600) || +ftpInput === profile.ftp}
              onClick={() => updateProfile({ ftp: Math.round(+ftpInput) })}
            >
              Save
            </button>
          </div>
          <span className="muted small">Don't know your FTP? Take the Ramp Test.</span>
        </label>
        <div className="setting">
          Speed units
          <div className="segmented" role="radiogroup" aria-label="Speed units">
            {(['kmh', 'mph'] as const).map((u) => (
              <button
                key={u}
                role="radio"
                aria-checked={profile.settings.speedUnit === u}
                className={profile.settings.speedUnit === u ? 'active' : ''}
                onClick={() => updateProfile({ settings: { ...profile.settings, speedUnit: u } })}
              >
                {speedLabel(u)}
              </button>
            ))}
          </div>
        </div>
        <div>
          Kit colour
          <div className="swatches">
            {colors.map((c) => (
              <button
                key={c}
                className={`swatch ${profile.cosmetics.kitColor === c ? 'selected' : ''}`}
                style={{ background: c }}
                onClick={() => updateProfile({ cosmetics: { ...profile.cosmetics, kitColor: c } })}
                aria-label={`kit colour ${c}`}
              />
            ))}
          </div>
        </div>
        <div className="muted small">
          Lifetime XP {Math.floor(profile.levels.totalXp).toLocaleString()} · Rank {profile.promotions.length ? roman(profile.promotions.length) : '–'} ({profile.promotions.length} training block{profile.promotions.length === 1 ? '' : 's'} completed)
        </div>
      </div>

      <div className="card">
        <h3>Fitness stats</h3>
        <p className="muted small">Every ride adds to the systems it trains, based on your time in each power zone. Stats never go down.</p>
        <StatsPanel />
      </div>

      <div className="card">
        <h3>Training plan</h3>
        <p className="muted small">
          {profile.plan
            ? `${GOALS[profile.plan.goal].name} · ${profile.plan.minutesByDay.filter((m) => m > 0).length} riding days a week`
            : 'No plan yet. The coach uses sensible defaults until you set one.'}
        </p>
        <button className="btn" onClick={() => setEditingPlan(true)}>
          {profile.plan ? 'Edit plan' : 'Set up my plan'}
        </button>
        {editingPlan && <PlanSetup onClose={() => setEditingPlan(false)} />}
      </div>

      <div className="card">
        <h3>Avatar tiers</h3>
        <div className="tier-gallery">
          {AVATAR_TIERS.map((t) => {
            const unlocked = level >= t.minLevel;
            return (
              <div key={t.title} className={`tier-card ${unlocked ? '' : 'locked'}`}>
                <Avatar level={t.minLevel} kitColor={unlocked ? profile.cosmetics.kitColor : '#555'} width={150} />
                <div className="tier-title">
                  {unlocked ? '' : '🔒 '}
                  {t.title}
                </div>
                <div className="muted small">Level {t.minLevel}+</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h3>Ride history</h3>
        <p className="muted small">The last few rides keep a second-by-second file you can upload to Strava or other training sites.</p>
        {profile.rides.length === 0 ? (
          <p className="muted">No rides yet.</p>
        ) : (
          <table className="history">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Avg</th>
                <th>kJ</th>
                <th>XP</th>
                <th>Zones</th>
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              {[...profile.rides].reverse().slice(0, 30).map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.startedAt).toLocaleDateString()}</td>
                  <td>{fmtClock(r.durationSec)}</td>
                  <td>{r.avgPower} W</td>
                  <td>{r.kj}</td>
                  <td>+{r.xpEarned}</td>
                  <td style={{ width: 160 }}>
                    <ZoneDistribution zoneSec={r.zoneSec} />
                  </td>
                  <td>
                    <RideExport ride={r} compact />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>About</h3>
        <p className="muted small">
          Cadence Quest is a free, open-source hobby project (
          <a href="https://github.com/svantreeck/cycling" target="_blank" rel="noreferrer">
            source on GitHub
          </a>
          , BSD 3-Clause license). It is not affiliated with or endorsed by Zwift, Wahoo, Strava or any other company
          mentioned; their names are used only to say which devices and services it works with. Training guidance here is
          general information, not medical advice: check with a doctor before starting hard training.
        </p>
      </div>

      <div className="card">
        <h3>Save data</h3>
        <p className="muted small">
          Progress is saved in this browser's local storage. Clearing your browser data deletes it, so export a backup now and then.
        </p>
        <div className="row">
          <button className="btn" onClick={download}>
            Export backup
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Import backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) importJson(await f.text());
              e.target.value = '';
            }}
          />
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('Reset all progress? This cannot be undone.')) resetProfile();
            }}
          >
            Reset progress
          </button>
        </div>
      </div>
    </div>
  );
}
