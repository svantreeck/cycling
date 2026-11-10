import { useEffect, useState } from 'react';
import { isWebBluetoothAvailable } from '../ble/ftms';
import { MockTrainer } from '../ble/mockTrainer';
import { useGame } from '../store/gameStore';

export function ConnectionChip() {
  const { conn, trainer, setScreen } = useGame();
  const label =
    conn === 'connected' ? trainer?.name ?? 'Connected' : conn === 'connecting' ? 'Connecting…' : conn === 'lost' ? 'Connection lost' : 'No trainer';
  return (
    <button className={`chip conn-${conn}`} onClick={() => setScreen('home')} title="Trainer connection">
      <span className="dot" /> {label}
    </button>
  );
}

export function ConnectPanel() {
  const { conn, trainer, connectBluetooth, connectMock, disconnect, reconnect } = useGame();
  const bt = isWebBluetoothAvailable();

  if (conn === 'connected' && trainer) {
    return (
      <div className="card connect">
        <div>
          <strong>{trainer.name}</strong>{' '}
          <span className="muted">
            {trainer.kind === 'mock' ? 'simulator' : trainer.kind === 'ftms' ? 'FTMS' : 'Cycling Power (read-only)'}
            {trainer.capabilities.erg ? ' · ERG ready' : ' · no ERG'}
          </span>
        </div>
        <button className="btn ghost" onClick={() => void disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }

  if (conn === 'lost') {
    return (
      <div className="card connect warn">
        <div>
          <strong>Trainer disconnected.</strong> Your challenge is paused.
        </div>
        <button className="btn primary" onClick={() => void reconnect()}>
          Reconnect
        </button>
        <button className="btn ghost" onClick={() => void disconnect()}>
          Give up
        </button>
      </div>
    );
  }

  return (
    <div className="card connect">
      {!bt && (
        <div className="banner">
          This browser doesn't support Web Bluetooth. Use <strong>Chrome</strong> or <strong>Edge</strong> on desktop or Android, or
          try the simulator.
        </div>
      )}
      <button className="btn primary" disabled={!bt || conn === 'connecting'} onClick={() => void connectBluetooth()}>
        {conn === 'connecting' ? 'Connecting…' : 'Connect trainer'}
      </button>
      <button className="btn" disabled={conn === 'connecting'} onClick={() => void connectMock()}>
        Use simulator
      </button>
      <p className="muted small">
        Close Zwift, the Wahoo app and any other app connected to the trainer. Only one app can control it at a time.
      </p>
    </div>
  );
}

/** Dev controls when using the MockTrainer. Arrow keys ±10 W (Shift ±50). */
export function SimControls() {
  const trainer = useGame((s) => s.trainer);
  const [, force] = useState(0);
  const mock = trainer instanceof MockTrainer ? trainer : null;

  useEffect(() => {
    if (!mock) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const step = e.shiftKey ? 50 : 10;
      if (e.key === 'ArrowUp') mock.riderPower = Math.min(1500, mock.riderPower + step);
      else if (e.key === 'ArrowDown') mock.riderPower = Math.max(0, mock.riderPower - step);
      else return;
      e.preventDefault();
      force((n) => n + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mock]);

  if (!mock) return null;
  const upd = (fn: () => void) => {
    fn();
    force((n) => n + 1);
  };
  return (
    <div className="card sim">
      <div className="sim-title">🧪 Simulator</div>
      <label>
        Rider power <strong>{mock.riderPower} W</strong>
        <input type="range" min={0} max={1000} step={5} value={mock.riderPower} onChange={(e) => upd(() => (mock.riderPower = +e.target.value))} />
      </label>
      <label>
        Cadence <strong>{mock.riderCadence} rpm</strong>
        <input type="range" min={0} max={140} value={mock.riderCadence} onChange={(e) => upd(() => (mock.riderCadence = +e.target.value))} />
      </label>
      <div className="sim-row">
        <label className="inline">
          <input type="checkbox" checked={mock.fatigued} onChange={(e) => upd(() => (mock.fatigued = e.target.checked))} /> Fatigue
        </label>
        <label className="inline">
          Time warp
          <select value={mock.timeWarp} onChange={(e) => upd(() => (mock.timeWarp = +e.target.value))}>
            {[1, 5, 20, 60].map((w) => (
              <option key={w} value={w}>
                {w}×
              </option>
            ))}
          </select>
        </label>
        <button className="btn small ghost" onClick={() => mock.simulateDrop()}>
          Drop BLE
        </button>
      </div>
      <div className="muted small">ERG target: {mock.currentErgTarget ?? 'free ride'} · ↑/↓ keys ±10 W (Shift ±50)</div>
    </div>
  );
}
