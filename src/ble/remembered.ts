/**
 * Remembers the Bluetooth trainer and shifters the rider last connected, so they can come back without hunting
 * through the device picker.
 *
 * - Browsers with `navigator.bluetooth.getDevices()` (Chrome with the "Web Bluetooth new permissions backend" flag,
 *   and possibly some iOS Bluetooth browsers) can reconnect to permitted devices with no prompt at all.
 * - Everywhere else a reconnect still needs a tap, but the picker is filtered to the remembered device's name so it is
 *   the only one listed.
 */

export interface RememberedDevice {
  id: string;
  name: string;
}

export interface RememberedDevices {
  trainer?: RememberedDevice;
  /** Zwift controller sides, most recent last */
  shifters: RememberedDevice[];
}

export const DEVICES_KEY = 'cyclingquest.devices';
const MAX_SHIFTERS = 2;

export function loadRemembered(storage: Storage | undefined = globalThis.localStorage): RememberedDevices {
  try {
    const raw = storage?.getItem(DEVICES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return { shifters: [], ...(parsed ?? {}) };
  } catch {
    return { shifters: [] };
  }
}

function save(d: RememberedDevices, storage: Storage | undefined) {
  try {
    storage?.setItem(DEVICES_KEY, JSON.stringify(d));
  } catch {
    /* storage full or blocked: remembering is best-effort */
  }
}

export function rememberTrainer(dev: RememberedDevice, storage: Storage | undefined = globalThis.localStorage) {
  save({ ...loadRemembered(storage), trainer: dev }, storage);
}

export function rememberShifter(dev: RememberedDevice, storage: Storage | undefined = globalThis.localStorage) {
  const cur = loadRemembered(storage);
  const shifters = [...cur.shifters.filter((s) => s.id !== dev.id), dev].slice(-MAX_SHIFTERS);
  save({ ...cur, shifters }, storage);
}

export function forgetTrainer(storage: Storage | undefined = globalThis.localStorage) {
  const { trainer: _, ...rest } = loadRemembered(storage);
  save(rest, storage);
}

export function forgetShifters(storage: Storage | undefined = globalThis.localStorage) {
  save({ ...loadRemembered(storage), shifters: [] }, storage);
}

type BluetoothWithGetDevices = Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> };
type WatchableDevice = BluetoothDevice & { watchAdvertisements?: (opts?: { signal?: AbortSignal }) => Promise<void> };

/** True when this browser can reconnect to a remembered device without the rider tapping anything. */
export const canAutoReconnect = () =>
  typeof navigator !== 'undefined' && typeof (navigator.bluetooth as BluetoothWithGetDevices | undefined)?.getDevices === 'function';

/** The already-permitted device with this id, if the browser exposes it. */
export async function permittedDevice(id: string): Promise<BluetoothDevice | null> {
  if (!canAutoReconnect()) return null;
  try {
    const devices = await (navigator.bluetooth as BluetoothWithGetDevices).getDevices!();
    return devices.find((d) => d.id === id) ?? null;
  } catch {
    return null;
  }
}

/**
 * Wait until the device is advertising (switched on and in range), so we don't hammer gatt.connect() at a trainer
 * that is off. Resolves false on timeout. Browsers without watchAdvertisements() resolve true straight away and the
 * connect attempt itself is the test.
 */
export async function waitUntilNearby(device: BluetoothDevice, timeoutMs: number): Promise<boolean> {
  const d = device as WatchableDevice;
  if (typeof d.watchAdvertisements !== 'function') return true;
  const ctrl = new AbortController();
  return new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      d.removeEventListener('advertisementreceived', onAd);
      ctrl.abort();
      resolve(ok);
    };
    const onAd = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    d.addEventListener('advertisementreceived', onAd);
    d.watchAdvertisements!({ signal: ctrl.signal }).catch(() => done(true));
  });
}

/** Chrome on a desktop or Android, where a flag turns on automatic reconnects. */
export const isChromeWithFlagOption = () =>
  typeof navigator !== 'undefined' &&
  !!navigator.bluetooth &&
  /Chrome\//.test(navigator.userAgent) &&
  !/iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !canAutoReconnect();

export const AUTO_RECONNECT_FLAG = 'chrome://flags/#enable-web-bluetooth-new-permissions-backend';
