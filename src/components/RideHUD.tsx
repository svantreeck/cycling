import { tierFor } from '../game/avatarTiers';
import { fmtDur } from '../game/challenges';
import { ZONES, zoneFor } from '../game/zones';
import { useEffect, useState } from 'react';
import { ERG_MAX_W, ERG_MIN_W, useGame } from '../store/gameStore';
import { convertSpeed, speedLabel } from '../units';
import { Avatar } from './Avatar';
import { ChallengeRunner } from './ChallengeRunner';
import { ConnectPanel, SimControls } from './ConnectPanel';
import { XPBar } from './XPBar';

export function RideScreen() {
  const { sample, ride, profile, startRide, endRide, runSnap, run, conn, lastRide, setScreen, updateProfile, freeErg } = useGame();
  const unit = profile.settings.speedUnit;
  const toggleUnit = () => updateProfile({ settings: { ...profile.settings, speedUnit: unit === 'kmh' ? 'mph' : 'kmh' } });
  const power = sample?.power ?? 0;
  const zone = zoneFor(power, profile.ftp);
  const pctFtp = Math.round((power / profile.ftp) * 100);

  return (
    <div className="ride">
      {conn !== 'connected' && <ConnectPanel />}

      <div className="ride-stage" style={{ ['--zone' as string]: zone.color }}>
        <Avatar
          level={profile.levels.level}
          kitColor={profile.cosmetics.kitColor}
          cadence={sample?.cadence ?? 0}
          speedKph={sample?.speedKph ?? 0}
          width={420}
        />
        <div className="ride-title">{tierFor(profile.levels.level).title}</div>
      </div>

      <div className="hud">
        <Metric
          label="Power"
          value={power}
          unit="W"
          big
          highlight={zone.color}
          sub={freeErg.on && !run ? `${pctFtp}% FTP · ERG ${freeErg.watts} W` : `${pctFtp}% FTP`}
        />
        <Metric label="Cadence" value={Math.round(sample?.cadence ?? 0)} unit="rpm" />
        <Metric
          label="Speed"
          value={convertSpeed(sample?.speedKph ?? 0, unit).toFixed(1)}
          unit={speedLabel(unit)}
          onClick={toggleUnit}
          title={`Tap to switch to ${unit === 'kmh' ? 'mph' : 'km/h'}`}
        />
        <Metric label="Time" value={fmtClock(ride?.elapsedSec ?? 0)} sub={ride?.paused ? 'paused' : undefined} />
        <Metric label="Ride XP" value={`+${Math.floor(ride?.xp ?? 0)}`} unit="XP" highlight="#ffd54f" />
      </div>

      <ZoneBar power={power} ftp={profile.ftp} />

      {runSnap && <ChallengeRunner />}

      {!run && <ErgControl />}

      <XPBar levels={profile.levels} compact />

      <div className="ride-actions">
        {!ride ? (
          <button className="btn primary big" disabled={conn !== 'connected'} onClick={startRide}>
            ▶ Start free ride
          </button>
        ) : (
          <>
            {!runSnap && (
              <button className="btn" onClick={() => setScreen('challenges')}>
                ⚡ Take a challenge
              </button>
            )}
            <button className="btn danger" onClick={endRide}>
              ■ End ride
            </button>
          </>
        )}
      </div>

      {lastRide && !ride && <RideSummaryCard />}
      <SimControls />
    </div>
  );
}

const ERG_STEP = 10;

/** Free-ride trainer mode: Sim (rider controls effort with gears) or ERG (trainer holds a wattage). */
function ErgControl() {
  const { trainer, conn, freeErg, setFreeErg, profile } = useGame();
  const [draft, setDraft] = useState(String(freeErg.watts));
  useEffect(() => setDraft(String(freeErg.watts)), [freeErg.watts]);

  if (conn !== 'connected' || !trainer) return null;
  if (!trainer.capabilities.erg) {
    return <div className="card muted small">This trainer is connected read-only, so ERG isn't available.</div>;
  }

  const commitDraft = () => {
    const w = Math.round(+draft);
    if (Number.isFinite(w) && draft.trim() !== '') setFreeErg({ watts: w });
    else setDraft(String(freeErg.watts));
  };

  return (
    <div className="card erg">
      <div className="erg-head">
        <strong>Trainer mode</strong>
        <div className="segmented">
          <button className={!freeErg.on ? 'active' : ''} onClick={() => setFreeErg({ on: false })}>
            Sim
          </button>
          <button className={freeErg.on ? 'active' : ''} onClick={() => setFreeErg({ on: true })}>
            ERG
          </button>
        </div>
      </div>
      <div className="erg-row">
        <button className="btn" onClick={() => setFreeErg({ watts: freeErg.watts - ERG_STEP })}>
          −{ERG_STEP}
        </button>
        <label className="erg-input">
          <input
            type="number"
            min={ERG_MIN_W}
            max={ERG_MAX_W}
            step={ERG_STEP}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <span className="unit">W</span>
        </label>
        <button className="btn" onClick={() => setFreeErg({ watts: freeErg.watts + ERG_STEP })}>
          +{ERG_STEP}
        </button>
        <span className="muted small">{Math.round((freeErg.watts / profile.ftp) * 100)}% FTP</span>
      </div>
      <div className="muted small">
        {freeErg.on
          ? 'The trainer holds this wattage whatever gear or cadence you ride.'
          : 'Sim mode: flat road, you set the effort with your gears. Switch to ERG to hold the target above.'}
      </div>
    </div>
  );
}

interface MetricProps {
  label: string;
  value: string | number;
  unit?: string;
  sub?: string;
  big?: boolean;
  highlight?: string;
  onClick?: () => void;
  title?: string;
}

function Metric({ label, value, unit, sub, big, highlight, onClick, title }: MetricProps) {
  return (
    <div
      className={`metric ${big ? 'big' : ''} ${onClick ? 'clickable' : ''}`}
      style={highlight ? { borderColor: highlight } : undefined}
      onClick={onClick}
      title={title}
      role={onClick ? 'button' : undefined}
    >
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={highlight ? { color: highlight } : undefined}>
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

function ZoneBar({ power, ftp }: { power: number; ftp: number }) {
  const z = zoneFor(power, ftp);
  return (
    <div className="zonebar">
      {ZONES.map((zone) => (
        <div key={zone.id} className={`zone ${zone.id === z.id && power > 0 ? 'active' : ''}`} style={{ background: zone.color }}>
          Z{zone.id}
          <span className="zone-name">{zone.name}</span>
        </div>
      ))}
    </div>
  );
}

function RideSummaryCard() {
  const r = useGame((s) => s.lastRide)!;
  return (
    <div className="card summary">
      <h3>Ride complete 🎉</h3>
      <div className="summary-grid">
        <div><span className="muted">Time</span> {fmtClock(r.durationSec)}</div>
        <div><span className="muted">Work</span> {r.kj} kJ</div>
        <div><span className="muted">Avg</span> {r.avgPower} W</div>
        <div><span className="muted">Max</span> {r.maxPower} W</div>
        <div><span className="muted">XP</span> +{r.xpEarned}</div>
        <div><span className="muted">Challenges</span> {r.challenges.filter((c) => c.passed).length}/{r.challenges.length}</div>
      </div>
      <ZoneDistribution zoneSec={r.zoneSec} />
    </div>
  );
}

export function ZoneDistribution({ zoneSec }: { zoneSec: number[] }) {
  const total = zoneSec.reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="zonedist">
      {zoneSec.map((s, i) =>
        s > 0 ? <div key={i} style={{ flex: s / total, background: ZONES[i].color }} title={`Z${i + 1}: ${fmtDur(s)}`} /> : null,
      )}
    </div>
  );
}

export function fmtClock(sec: number) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
}
