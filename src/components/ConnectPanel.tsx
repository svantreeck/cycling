import { useEffect, useState } from 'react';
import { isWebBluetoothAvailable } from '../ble/ftms';
import { MockTrainer } from '../ble/mockTrainer';
import { MockController, type ControllerAction } from '../ble/controller';
import { ZwiftClickController } from '../ble/zwiftClick';
import { AUTO_RECONNECT_FLAG, isChromeWithFlagOption } from '../ble/remembered';
import { useGame } from '../store/gameStore';

/** iPhone/iPad, including iPads that report a Mac user agent. */
const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1));

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

/** One "Devices" card: a Trainer slot and a Virtual shifters slot, each showing its connect buttons or what's connected. */
export function ConnectPanel() {
  const bt = isWebBluetoothAvailable();
  return (
    <div className="card devices">
      {!bt && (
        <div className="banner">
          {isIOS() ? (
            <>
              Safari can't use Bluetooth on iPad or iPhone. Open this page in <strong>Bluefy</strong> (free on the App Store) to connect your
              trainer and Click, or try the simulator.
            </>
          ) : (
            <>
              This browser doesn't support Web Bluetooth. Use <strong>Chrome</strong> or <strong>Edge</strong> on desktop or Android, or try the
              simulator.
            </>
          )}
        </div>
      )}
      <div className="device-grid">
        <TrainerSlot />
        <ShifterSlot />
        <HeartRateSlot />
      </div>
      <AutoReconnectTip />
    </div>
  );
}

/** Chrome can reconnect without a tap, but only with a flag on. Mention it once there is something to reconnect. */
function AutoReconnectTip() {
  const { remembered, conn, controllerConn } = useGame();
  const [hidden, setHidden] = useState(() => localStorage.getItem('cyclingquest.hideFlagTip') === '1');
  const hasRemembered = !!remembered.trainer || remembered.shifters.length > 0 || !!remembered.heartRate;
  if (hidden || !hasRemembered || !isChromeWithFlagOption() || (conn === 'connected' && controllerConn === 'connected')) return null;
  return (
    <p className="muted small flag-tip">
      To reconnect automatically, open <code>{AUTO_RECONNECT_FLAG}</code>, enable it and relaunch Chrome.{' '}
      <button
        className="link"
        onClick={() => {
          localStorage.setItem('cyclingquest.hideFlagTip', '1');
          setHidden(true);
        }}
      >
        Hide
      </button>
    </p>
  );
}

/** A device slot before anything is connected: the main connect button, then smaller options on one line. */
function SlotConnect(props: {
  label: string;
  onConnect: () => void;
  onOther?: () => void;
  simLabel: string;
  onSim: () => void;
  onForget?: () => void;
  disabled: boolean;
  busy: boolean;
  hint?: string;
  extra?: React.ReactNode;
}) {
  const { label, onConnect, onOther, simLabel, onSim, onForget, disabled, busy, hint, extra } = props;
  return (
    <>
      <button className="btn primary slot-main" disabled={disabled || busy} onClick={onConnect} title={onOther ? 'Opens the picker showing only this device' : undefined}>
        {busy ? 'Connecting…' : label}
      </button>
      <div className="slot-links">
        {onOther && (
          <button className="btn ghost small" disabled={disabled || busy} onClick={onOther}>
            Other…
          </button>
        )}
        <button className="btn ghost small" disabled={busy} onClick={onSim}>
          {simLabel}
        </button>
        {onForget && (
          <button className="link small" onClick={onForget}>
            Forget
          </button>
        )}
        {extra}
      </div>
      {hint && <p className="muted small">{hint}</p>}
    </>
  );
}

function TrainerSlot() {
  const { conn, trainer, connectBluetooth, connectMock, disconnect, reconnect, remembered, autoStatus, forgetDevices } = useGame();
  const bt = isWebBluetoothAvailable();
  const connected = conn === 'connected' && trainer;
  const last = remembered.trainer;
  return (
    <section className={`device-slot ${conn === 'lost' ? 'warn' : ''}`}>
      <h4>
        🚴 Trainer <span className={`slot-dot conn-${conn}`}><span className="dot" /></span>
      </h4>
      {connected ? (
        <>
          <div className="device-row">
            <div>
              <strong>{trainer.name}</strong>
              <div className="muted small">
                {trainer.kind === 'mock' ? 'Simulator' : trainer.kind === 'ftms' ? 'Smart trainer (FTMS)' : 'Power only (read-only)'}
                {trainer.capabilities.erg ? ' · ERG ready' : ' · no ERG'}
              </div>
            </div>
            <button className="btn ghost small" onClick={() => void disconnect()}>
              Disconnect
            </button>
          </div>
        </>
      ) : conn === 'lost' ? (
        <>
          <div className="small">
            <strong>{trainer?.name ?? 'Trainer'} disconnected.</strong> Your ride is paused.
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => void reconnect()}>
              Reconnect
            </button>
            <button className="btn ghost" onClick={() => void disconnect()}>
              Give up
            </button>
          </div>
        </>
      ) : (
        <SlotConnect
          label={last ? `Reconnect ${last.name}` : 'Connect trainer'}
          onConnect={() => void connectBluetooth(last?.name)}
          onOther={last ? () => void connectBluetooth() : undefined}
          simLabel="Simulator"
          onSim={() => void connectMock()}
          onForget={last ? () => forgetDevices('trainer') : undefined}
          disabled={!bt}
          busy={conn === 'connecting'}
          hint={autoStatus.trainer ?? (last ? undefined : 'Close Zwift, the Wahoo app or anything else using the trainer first.')}
        />
      )}
    </section>
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

/** Heart-rate monitor: any strap, arm band or watch broadcasting the standard Bluetooth heart rate service. */
function HeartRateSlot() {
  const { hrm, hrmConn, heartRate, connectHeartRate, connectMockHeartRate, disconnectHeartRate, remembered, autoStatus, forgetDevices } = useGame();
  const bt = isWebBluetoothAvailable();
  const last = remembered.heartRate;
  const busy = hrmConn === 'connecting';
  const dot = hrmConn === 'reconnecting' ? 'connecting' : hrmConn;

  return (
    <section className={`device-slot ${hrmConn === 'lost' ? 'warn' : ''}`}>
      <h4>
        ❤️ Heart rate <span className={`slot-dot conn-${dot}`}><span className="dot" /></span>
      </h4>
      {hrm && hrmConn !== 'connecting' ? (
        <div className="device-row">
          <div>
            <strong>{hrm.name}</strong>
            <div className="muted small">
              {hrmConn === 'reconnecting' ? 'Reconnecting…' : hrmConn === 'lost' ? 'Connection lost' : heartRate != null ? `♥ ${heartRate} bpm` : 'Waiting for a reading…'}
            </div>
          </div>
          <button className="btn ghost small" onClick={() => void disconnectHeartRate()}>
            Disconnect
          </button>
        </div>
      ) : (
        <SlotConnect
          label={last ? `Reconnect ${last.name}` : 'Connect HR monitor'}
          onConnect={() => void connectHeartRate(last?.name)}
          onOther={last ? () => void connectHeartRate() : undefined}
          simLabel="Simulated"
          onSim={() => void connectMockHeartRate()}
          onForget={last ? () => forgetDevices('heartRate') : undefined}
          disabled={!bt}
          busy={busy}
          hint={autoStatus.heartRate ?? (last ? undefined : 'Optional: a chest strap, arm band or watch that broadcasts heart rate.')}
        />
      )}
    </section>
  );
}

/** Virtual shifters: a Zwift Click/Ride/Play connected directly, or a simulated one. */
function ShifterSlot() {
  const { controller, controllerConn, connectZwiftClick, connectMockController, disconnectController, remembered, autoStatus, forgetDevices } = useGame();
  const bt = isWebBluetoothAvailable();
  const [help, setHelp] = useState(false);
  const lastName = remembered.shifters.length ? remembered.shifters[remembered.shifters.length - 1].name : null;
  const connected = !!controller && controllerConn === 'connected';

  let body;
  if (connected && controller instanceof ZwiftClickController) body = <ZwiftClickPanel click={controller} />;
  else if (connected) {
    body = (
      <div className="device-row">
        <div>
          <strong>{controller.name}</strong>
          <div className="muted small">On-screen pad, or the − / + keys.</div>
        </div>
        <button className="btn ghost small" onClick={() => void disconnectController()}>
          Disconnect
        </button>
      </div>
    );
  } else {
    body = (
      <>
        <SlotConnect
          label={lastName ? `Reconnect ${lastName}` : 'Connect Zwift Click'}
          onConnect={() => void connectZwiftClick(lastName ?? undefined)}
          onOther={lastName ? () => void connectZwiftClick() : undefined}
          simLabel="Simulated"
          onSim={() => void connectMockController()}
          onForget={lastName ? () => forgetDevices('shifters') : undefined}
          disabled={!bt}
          busy={controllerConn === 'connecting'}
          hint={
            autoStatus.shifters ??
            (controllerConn === 'lost'
              ? 'Connection lost.'
              : lastName
                ? 'Press a button to wake it first.'
                : 'Optional: shift and control workouts from the bars.')
          }
          extra={
            !lastName && (
              <button className="link small" onClick={() => setHelp((h) => !h)}>
                {help ? 'Hide setup' : 'How to set up'}
              </button>
            )
          }
        />
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
      </>
    );
  }

  return (
    <section className="device-slot">
      <h4>
        🎮 Virtual shifters <span className={`slot-dot conn-${controller ? controllerConn : 'disconnected'}`}><span className="dot" /></span>
      </h4>
      {body}
    </section>
  );
}

/** Status of directly connected Zwift controllers: which sides are connected, lock state and battery. */
function ZwiftClickPanel({ click }: { click: ZwiftClickController }) {
  useGame((s) => s.controllerRev); // re-render on pod changes
  const { connectZwiftClick, disconnectController } = useGame();
  const pods = click.podInfo;
  const bothSides = pods.filter((p) => p.state === 'connected' || p.state === 'reconnecting').length >= 2 || pods.some((p) => p.side === 'left');

  return (
    <div className="zwift">
      <div className="zwift-head">
        <strong>Zwift controller</strong>
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
              {p.battery != null && ` · 🔋${p.battery}%`}
            </span>
          </div>
        ))}
      </div>
      {!bothSides && <div className="muted small">Right side only: + shifts up, B shifts down.</div>}
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
