import { useEffect, useState } from 'react';
import { isWebBluetoothAvailable } from '../ble/ftms';
import { MockTrainer } from '../ble/mockTrainer';
import { MockController, type ControllerAction } from '../ble/controller';
import { inspectDevice, ZwiftClickController } from '../ble/zwiftClick';
import { BUTTON_LABEL } from '../ble/zwiftProtocol';
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

/** Connect a controller: a Zwift Click/Ride/Play directly, or a simulated one. */
export function ControllerPanel() {
  const { controller, controllerConn, connectZwiftClick, connectMockController, disconnectController } = useGame();
  const bt = isWebBluetoothAvailable();
  const [help, setHelp] = useState(false);

  if (controller instanceof ZwiftClickController && controllerConn === 'connected') return <ZwiftClickPanel click={controller} />;

  if (controller && controllerConn === 'connected') {
    return (
      <div className="card connect controller">
        <div>
          🎮 <strong>{controller.name}</strong> <span className="muted">· controller connected</span>
        </div>
        <button className="btn ghost" onClick={() => void disconnectController()}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="card connect controller">
      <div>
        🎮 <strong>Controller</strong>{' '}
        <span className="muted small">{controllerConn === 'lost' ? 'Connection lost.' : 'Shift gears and control workouts from your handlebars.'}</span>
      </div>
      <button className="btn" disabled={!bt || controllerConn === 'connecting'} onClick={() => void connectZwiftClick()}>
        {controllerConn === 'connecting' ? 'Connecting…' : 'Connect Zwift Click'}
      </button>
      <button className="btn ghost small" onClick={() => void connectMockController()}>
        Simulated
      </button>
      <button className="link small" onClick={() => setHelp((h) => !h)}>
        {help ? 'Hide setup' : 'How to set up'}
      </button>
      {help && (
        <div className="muted small controller-help">
          <ol>
            <li>Close Zwift, BikeControl and any other app using the Click. A controller accepts only one connection.</li>
            <li>If your Clicks are paired to the trainer (KICKR bridge / virtual shifting), unpair them there first, or the browser won't see them.</li>
            <li>
              Press a button on the <strong>right</strong> (+) side to wake it, click <strong>Connect Zwift Click</strong> and pick it. Then use{' '}
              <strong>Add other side</strong> for the left (−) side.
            </li>
            <li>
              The right side always works: <strong>+</strong> shifts up, <strong>B</strong> shifts down. The left side needs the Zwift app to unlock it about once a
              day. Without that it may stop after about a minute (the app reconnects it automatically).
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}

const ACTION_LABEL: Record<ControllerAction, string> = {
  shiftUp: 'shift up',
  shiftDown: 'shift down',
  harder: 'harder',
  easier: 'easier',
  skip: 'skip',
  pause: 'pause',
  resume: 'resume',
  select: 'select',
};

/** Status, button tester and diagnostics for directly connected Zwift controllers. */
function ZwiftClickPanel({ click }: { click: ZwiftClickController }) {
  useGame((s) => s.controllerRev); // re-render on pod/log changes
  const { connectZwiftClick, disconnectController } = useGame();
  const [lastPress, setLastPress] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [inspectLog, setInspectLog] = useState<string[]>([]);

  useEffect(
    () =>
      click.onButton(({ button, action }) => {
        setLastPress(`${BUTTON_LABEL[button]} → ${action ? ACTION_LABEL[action] : 'no action'}`);
      }),
    [click],
  );

  const pods = click.podInfo;
  const hasLeft = pods.some((p) => p.side === 'left');
  const lines = [...click.log.map((l) => `${new Date(l.at).toLocaleTimeString()} ${l.pod} ${l.dir === 'in' ? '←' : l.dir === 'out' ? '→' : '·'} ${l.text}`), ...inspectLog];
  const copy = () => void navigator.clipboard.writeText(lines.join('\n'));
  const inspect = (sendRideOn: boolean) =>
    void inspectDevice((t) => setInspectLog((l) => [...l.slice(-199), `${new Date().toLocaleTimeString()} inspect · ${t}`]), sendRideOn).catch((e) =>
      setInspectLog((l) => [...l, `inspect failed: ${(e as Error).message}`]),
    );

  return (
    <div className="card connect controller zwift">
      <div className="zwift-head">
        🎮 <strong>Zwift controller</strong>
        <button className="btn small" onClick={() => void connectZwiftClick()}>
          {pods.length < 2 ? 'Add other side' : 'Add another'}
        </button>
        <button className="btn ghost small" onClick={() => void disconnectController()}>
          Disconnect
        </button>
      </div>
      <div className="pods">
        {pods.map((p) => (
          <div key={p.id} className={`pod state-${p.state}`}>
            <span className="dot" />
            <strong>{p.name}</strong>
            <span className="muted small">
              {p.side !== 'unknown' ? `${p.side} side` : 'press a button to identify'} · {p.state}
              {p.lock === 'locked' && ' · 🔒 locked (needs Zwift unlock)'}
              {p.lock === 'unlocked' && ' · unlocked'}
              {p.battery != null && ` · 🔋${p.battery}%`}
            </span>
          </div>
        ))}
      </div>
      <div className="small">
        {lastPress ? (
          <>
            Last press: <strong>{lastPress}</strong>
          </>
        ) : (
          <span className="muted">Press a button to test it.</span>
        )}
        {!hasLeft && <span className="muted"> · Right side only: + shifts up, B shifts down.</span>}
      </div>
      <div className="row">
        <button className="link small" onClick={() => setShowLog((v) => !v)}>
          {showLog ? 'Hide' : 'Show'} Bluetooth log ({lines.length})
        </button>
        {showLog && (
          <>
            <button className="btn ghost small" onClick={copy}>
              Copy log
            </button>
            <button className="btn ghost small" onClick={() => inspect(false)} title="Connect to any device (e.g. your KICKR) and log its services and Zwift notifications">
              Inspect a device…
            </button>
            <button className="btn ghost small" onClick={() => inspect(true)} title="Same, and send the Zwift RideOn handshake">
              Inspect + RideOn…
            </button>
          </>
        )}
      </div>
      {showLog && <pre className="ble-log">{lines.slice(-80).join('\n') || 'Nothing yet.'}</pre>}
    </div>
  );
}

/** On-screen buttons for the simulated controller. */
export function MockControllerPad() {
  const controller = useGame((s) => s.controller);
  if (!(controller instanceof MockController)) return null;
  const buttons: [ControllerAction, string][] = [
    ['shiftDown', '⬇ Shift'],
    ['shiftUp', '⬆ Shift'],
    ['easier', 'Easier'],
    ['harder', 'Harder'],
    ['skip', 'Skip'],
    ['pause', 'Pause'],
    ['resume', 'Resume'],
    ['select', 'Select'],
  ];
  return (
    <div className="card sim">
      <div className="sim-title">🎮 Simulated controller</div>
      <div className="sim-row">
        {buttons.map(([a, label]) => (
          <button key={a} className="btn small ghost" onClick={() => controller.press(a)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
