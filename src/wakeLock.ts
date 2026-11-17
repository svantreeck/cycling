/**
 * Keep the screen awake while riding, so a tablet doesn't lock and drop Bluetooth mid-ride.
 * Uses the Screen Wake Lock API where available (Chrome, Safari 16.4+); a no-op elsewhere.
 */

type WakeLockSentinelLike = { release(): Promise<void>; released?: boolean };
type NavigatorWithWakeLock = Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } };

let sentinel: WakeLockSentinelLike | null = null;
let wanted = false;

async function acquire() {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as NavigatorWithWakeLock | undefined;
  if (!wanted || !nav?.wakeLock || document.visibilityState !== 'visible') return;
  try {
    sentinel = await nav.wakeLock.request('screen');
  } catch {
    sentinel = null; // e.g. low battery or not allowed; nothing else to do
  }
}

// The browser releases the lock when the page is hidden; take it again when the rider comes back.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible' && (!sentinel || sentinel.released)) void acquire();
  });
}

export function keepScreenAwake(on: boolean) {
  wanted = on;
  if (on) void acquire();
  else {
    void sentinel?.release().catch(() => undefined);
    sentinel = null;
  }
}
