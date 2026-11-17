import { create } from 'zustand';
import { BluetoothTrainer } from '../ble/ftms';
import { MockTrainer } from '../ble/mockTrainer';
import { MockController, type Controller, type ControllerAction } from '../ble/controller';
import { ZwiftClickController } from '../ble/zwiftClick';
import { HeartRateMonitor, MockHeartRate, type HeartRateSource, type HrState } from '../ble/heartRate';
import {
  canAutoReconnect,
  forgetHeartRate,
  forgetShifters,
  forgetTrainer,
  loadRemembered,
  permittedDevice,
  rememberHeartRate,
  rememberShifter,
  rememberTrainer,
  waitUntilNearby,
  type RememberedDevices,
} from '../ble/remembered';
import type { Trainer, TrainerSample, Unsubscribe } from '../ble/trainer';
import { tiersReached, type AvatarTier } from '../game/avatarTiers';
import { ChallengeRun, type RunResult, type RunSnapshot, type TrainerCommand } from '../game/challengeEngine';
import { challengeById, RAMP_TEST, roman, type Challenge, type FitnessSystem } from '../game/challenges';
import { blockInfo, isPromoted, suggestToday, type Feel } from '../game/coach';
import { clampGear, DEFAULT_GEAR, gradeForGear } from '../game/gears';
import { challengeReward, promotionXp } from '../game/rewards';
import { addStats, statGains, statLevel, SYSTEMS } from '../game/stats';
import { addXp, rideXp, type AddXpResult } from '../game/xp';
import { zoneFor } from '../game/zones';
import { keepScreenAwake } from '../wakeLock';
import { saveTrack, TrackRecorder } from '../strava/track';
import {
  defaultProfile,
  exportProfile,
  importProfile,
  loadProfile,
  saveProfile,
  type Profile,
  type RideSummary,
} from './persistence';

export type Screen = 'home' | 'ride' | 'challenges' | 'profile';
export type ConnStatus = 'disconnected' | 'connecting' | 'connected' | 'lost';

const IDLE_PAUSE_MS = 5000;
const MAX_DT_MS = 5000;
const AUTOSAVE_MS = 30_000;
export const ERG_MIN_W = 50;
export const ERG_MAX_W = 1000;

/** User-chosen ERG target for free riding (outside challenges). */
export interface FreeErg {
  on: boolean;
  watts: number;
}

const clampErg = (w: number) => Math.round(Math.min(ERG_MAX_W, Math.max(ERG_MIN_W, w)));

export interface LiveRide {
  startedAt: number;
  elapsedSec: number;
  xp: number;
  /** watt-seconds (J) */
  joules: number;
  maxPower: number;
  zoneSec: number[];
  /** Σ (power / FTP)² × seconds; TSS = stress / 36 */
  stress: number;
  /** Σ bpm × seconds and the seconds it covers, for the average heart rate */
  hrBeats: number;
  hrSec: number;
  maxHr: number;
  lastT: number | null;
  idleMs: number;
  paused: boolean;
  challenges: { id: string; passed: boolean; xp: number; feel?: Feel }[];
}

export type Celebration =
  | { kind: 'levelUp'; levels: number[]; tiers: AvatarTier[] }
  | { kind: 'promotion'; rank: number; block: number; oldFtp: number; newFtp: number; xp: number }
  | { kind: 'stat'; system: FitnessSystem; level: number };

export interface RunOutcome {
  challenge: Challenge;
  result: RunResult;
  xp: number;
  lines: string[];
  oldFtp: number;
  /** post-workout check-in, once answered */
  feel?: Feel;
  /** set when this ramp test completed a training block */
  promotion?: { rank: number; block: number };
}

interface GameState {
  profile: Profile;
  screen: Screen;
  trainer: Trainer | null;
  conn: ConnStatus;
  error: string | null;
  sample: TrainerSample | null;
  ride: LiveRide | null;
  lastRide: RideSummary | null;
  run: ChallengeRun | null;
  runSnap: RunSnapshot | null;
  outcome: RunOutcome | null;
  celebrations: Celebration[];
  freeErg: FreeErg;
  /** handlebar controller (Zwift Click, or the simulated one) */
  controller: Controller | null;
  controllerConn: ConnStatus;
  /** virtual gear for free riding (1…GEAR_COUNT) */
  gear: number;
  /** brief feedback for controller/keyboard actions */
  toast: { text: string; id: number } | null;
  /** a swap chosen on the Today card, valid while the suggestion it replaced is still current */
  todayPick: { suggestionId: string; workoutId: string } | null;
  /** bumps when the controller's own state changes (pods, battery, log) so panels re-render */
  controllerRev: number;
  /** the trainer and shifters connected last time, for one-tap or automatic reconnects */
  remembered: RememberedDevices;
  /** what an automatic reconnect is waiting for, per slot */
  autoStatus: { trainer?: string; shifters?: string; heartRate?: string };
  /** heart-rate monitor (a Bluetooth strap, or the simulated one) */
  hrm: HeartRateSource | null;
  hrmConn: 'disconnected' | HrState;
  /** latest heart rate in bpm; null when none has arrived for a few seconds */
  heartRate: number | null;

  setScreen(s: Screen): void;
  /** Connect a Bluetooth trainer. With `name`, the picker lists only that device (one-tap reconnect). */
  connectBluetooth(name?: string): Promise<void>;
  connectMock(): Promise<void>;
  reconnect(): Promise<void>;
  disconnect(): Promise<void>;
  startRide(): void;
  endRide(): void;
  startChallenge(id: string): void;
  abortChallenge(): void;
  dismissOutcome(): void;
  /** Post-workout check-in: record how the last workout felt (the coach uses it to pick the next rung). */
  rateWorkout(feel: Feel): void;
  dismissCelebration(): void;
  /** Turn free-ride ERG on/off or change its target. Ignored while a challenge controls the trainer. */
  setFreeErg(patch: Partial<FreeErg>): void;
  updateProfile(patch: Partial<Pick<Profile, 'name' | 'ftp' | 'cosmetics' | 'settings' | 'plan'>>): void;
  importJson(json: string): void;
  exportJson(): string;
  resetProfile(): void;
  clearError(): void;
  connectMockController(): Promise<void>;
  /** Connect a Zwift Click/Ride/Play directly. If one is already connected, adds another side. */
  connectZwiftClick(name?: string): Promise<void>;
  /** On page load: reconnect remembered devices without prompting, where the browser allows it. */
  autoConnect(): Promise<void>;
  forgetDevices(kind: 'trainer' | 'shifters' | 'heartRate'): void;
  /** Connect a heart-rate monitor. With `name`, the picker lists only that device. */
  connectHeartRate(name?: string): Promise<void>;
  connectMockHeartRate(): Promise<void>;
  disconnectHeartRate(): Promise<void>;
  disconnectController(): Promise<void>;
  /** Handle a controller button (or keyboard shortcut). */
  controllerAction(a: ControllerAction): void;
  setTodayPick(pick: { suggestionId: string; workoutId: string } | null): void;
}

export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The workout that earns today's ×1.5 XP bonus: the coach's suggestion, or the swap the rider picked on the Today card.
 * Undefined once claimed today, and on rest days (the bonus shouldn't tempt anyone into riding then).
 */
export function todayBonusId(
  profile: Profile,
  todayPick: { suggestionId: string; workoutId: string } | null,
  now = Date.now(),
): string | undefined {
  if (profile.bonusClaimedOn === localDate(new Date(now))) return undefined;
  const s = suggestToday(profile, now);
  if (s.kind === 'rest') return undefined;
  return todayPick?.suggestionId === s.workout.id ? todayPick.workoutId : s.workout.id;
}

export const todayBonusClaimed = (profile: Profile, now = Date.now()) => profile.bonusClaimedOn === localDate(new Date(now));

let unsubs: Unsubscribe[] = [];
let lastSave = 0;
/** Second-by-second track of the current ride (kept outside the store: it grows every second). */
let track = new TrackRecorder();
/** a reading older than this is treated as no heart rate (strap off, or out of range) */
const HR_STALE_MS = 5000;
let lastHrAt = 0;

export const useGame = create<GameState>((set, get) => {
  const persist = (profile: Profile) => {
    saveProfile(profile);
    lastSave = Date.now();
  };

  const sendCommands = (cmds: TrainerCommand[]) => {
    const t = get().trainer;
    if (!t) return;
    for (const c of cmds) {
      // Free riding uses the current virtual gear's grade.
      const p = c.type === 'erg' ? t.setErgPower(c.watts) : t.setFreeRide(gradeForGear(get().gear));
      p.catch((e) => console.warn('Trainer command failed', c, e));
    }
  };

  /** Fold an addXp result into state, queueing level-up celebrations. */
  const applyLevelResult = (profile: Profile, res: AddXpResult): Profile => {
    const before = profile.levels;
    const next = { ...profile, levels: res.state };
    const celebrations: Celebration[] = [];
    if (res.levelsGained.length) {
      celebrations.push({
        kind: 'levelUp',
        levels: res.levelsGained,
        tiers: tiersReached(before.level, res.state.level),
      });
    }
    if (celebrations.length) {
      set((s) => ({ celebrations: [...s.celebrations, ...celebrations] }));
      persist(next);
    }
    return next;
  };

  const finalizeRun = (run: ChallengeRun) => {
    const snap = run.snapshot();
    const result = snap.result ?? { passed: false, aborted: true, reason: 'Ended.' };
    const { profile, ride } = get();
    const challenge = run.challenge;
    const record = profile.completed[challenge.id] ?? { count: 0, attempts: 0 };
    // The bonus is decided by the suggestion as it stood when the workout started (rides are only added at ride end).
    const isBonus = run.bonusId === challenge.id;
    const reward = challengeReward({
      challenge,
      result,
      previousCompletions: record.count,
      isBonus,
      oldFtp: profile.ftp,
    });

    let next: Profile = {
      ...profile,
      completed: {
        ...profile.completed,
        [challenge.id]: {
          attempts: record.attempts + 1,
          count: record.count + (result.passed ? 1 : 0),
          lastCompletedAt: result.passed ? Date.now() : record.lastCompletedAt,
          best: Math.max(record.best ?? 0, result.bestAvgPower ?? 0) || undefined,
        },
      },
    };
    if (result.passed && isBonus) next.bonusClaimedOn = localDate();
    if (result.passed && result.newFtp && challenge.id === RAMP_TEST.id) {
      next.ftp = result.newFtp;
      next.ftpHistory = [...next.ftpHistory, { at: Date.now(), ftp: result.newFtp }];
    }
    // Passing the retest at the end of a training block earns a promotion.
    let promotion: RunOutcome['promotion'];
    const block = next.plan ? blockInfo(next.plan) : null;
    if (result.passed && challenge.id === RAMP_TEST.id && next.plan && block?.retestFor && !isPromoted(next.promotions, next.plan, block.retestFor)) {
      const rank = next.promotions.length + 1;
      const bonus = promotionXp(rank);
      const newFtp = result.newFtp ?? profile.ftp;
      next.promotions = [...next.promotions, { planCreatedAt: next.plan.createdAt, block: block.retestFor, at: Date.now(), oldFtp: profile.ftp, newFtp }];
      reward.xp += bonus;
      reward.lines.push(`Block ${block.retestFor} complete: promoted to Rank ${roman(rank)}! +${bonus} XP`);
      promotion = { rank, block: block.retestFor };
      set((s) => ({ celebrations: [...s.celebrations, { kind: 'promotion', rank, block: block.retestFor!, oldFtp: profile.ftp, newFtp, xp: bonus }] }));
    }
    if (reward.xp > 0) next = applyLevelResult(next, addXp(next.levels, reward.xp));

    persist(next);
    set({
      profile: next,
      run: null,
      runSnap: snap,
      outcome: { challenge, result, xp: reward.xp, lines: reward.lines, oldFtp: profile.ftp, promotion },
      ride: ride
        ? { ...ride, xp: ride.xp + reward.xp, challenges: [...ride.challenges, { id: challenge.id, passed: result.passed, xp: reward.xp }] }
        : ride,
    });
  };

  const handleSample = (sample: TrainerSample) => {
    const state = get();
    let { profile, ride } = state;

    if (ride) {
      const dt = ride.lastT == null ? 0 : Math.min(Math.max(0, sample.t - ride.lastT), MAX_DT_MS);
      const idle = sample.power <= 0 && sample.cadence <= 0;
      const idleMs = idle ? ride.idleMs + dt : 0;
      const paused = idleMs >= IDLE_PAUSE_MS;
      ride = { ...ride, lastT: sample.t, idleMs, paused };
      const hr = state.heartRate;
      track.add(sample, dt, !paused && dt > 0, hr);
      if (!paused && dt > 0 && hr) {
        ride = { ...ride, hrBeats: ride.hrBeats + hr * (dt / 1000), hrSec: ride.hrSec + dt / 1000, maxHr: Math.max(ride.maxHr, hr) };
      }
      if (!paused && dt > 0) {
        const zone = zoneFor(sample.power, profile.ftp);
        const zoneSec = [...ride.zoneSec];
        if (sample.power > 0) zoneSec[zone.id - 1] += dt / 1000;
        const gained = rideXp(sample.power, profile.ftp, dt / 1000);
        ride = {
          ...ride,
          elapsedSec: ride.elapsedSec + dt / 1000,
          joules: ride.joules + sample.power * (dt / 1000),
          maxPower: Math.max(ride.maxPower, sample.power),
          zoneSec,
          stress: ride.stress + (sample.power / profile.ftp) ** 2 * (dt / 1000),
          xp: ride.xp + gained,
        };
        if (gained > 0) profile = applyLevelResult(profile, addXp(profile.levels, gained));
      }
    }

    set({ sample, ride, profile, ...(state.heartRate != null && Date.now() - lastHrAt > HR_STALE_MS ? { heartRate: null } : {}) });

    const run = get().run;
    if (run) {
      sendCommands(run.update(sample));
      if (run.done) finalizeRun(run);
      else set({ runSnap: run.snapshot() });
    }

    if (Date.now() - lastSave > AUTOSAVE_MS) persist(get().profile);
  };

  const ergOff = () => set((s) => ({ freeErg: { ...s.freeErg, on: false } }));

  const attach = async (trainer: Trainer, quiet = false) => {
    unsubs.forEach((u) => u());
    unsubs = [];
    set((s) => ({ trainer, conn: 'connecting', error: null, freeErg: { ...s.freeErg, on: false } }));
    unsubs.push(trainer.onSample(handleSample));
    unsubs.push(
      trainer.onDisconnect(() => {
        set({ conn: 'lost' });
      }),
    );
    try {
      await trainer.connect();
      set({ conn: 'connected' });
      if (trainer instanceof BluetoothTrainer && trainer.identity) {
        rememberTrainer(trainer.identity);
        set({ remembered: loadRemembered() });
      }
    } catch (e) {
      unsubs.forEach((u) => u());
      unsubs = [];
      set({ trainer: null, conn: 'disconnected', error: quiet ? get().error : errorMessage(e) });
    }
  };

  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  const toast = (text: string) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { text, id: Date.now() } });
    toastTimer = setTimeout(() => set({ toast: null }), 1800);
  };

  let hrUnsubs: Unsubscribe[] = [];
  const attachHeartRate = async (m: HeartRateSource, quiet = false) => {
    hrUnsubs.forEach((u) => u());
    hrUnsubs = [
      m.onHeartRate((bpm) => {
        lastHrAt = Date.now();
        set({ heartRate: bpm });
      }),
      m.onState((s) => set({ hrmConn: s, ...(s === 'connected' ? {} : { heartRate: null }) })),
    ];
    set({ hrm: m, hrmConn: 'connecting', error: null });
    try {
      await m.connect();
      set({ hrmConn: 'connected' });
      if (m instanceof HeartRateMonitor && m.identity) {
        rememberHeartRate(m.identity);
        set({ remembered: loadRemembered() });
      }
    } catch (e) {
      hrUnsubs.forEach((u) => u());
      hrUnsubs = [];
      set({ hrm: null, hrmConn: 'disconnected', error: quiet ? get().error : errorMessage(e) });
    }
  };

  let controllerUnsubs: Unsubscribe[] = [];
  const rememberPods = (c: Controller) => {
    if (!(c instanceof ZwiftClickController)) return;
    for (const p of c.podInfo) rememberShifter({ id: p.id, name: p.name });
    set({ remembered: loadRemembered() });
  };

  const attachController = async (c: Controller, source: { device?: BluetoothDevice; name?: string } = {}, quiet = false) => {
    controllerUnsubs.forEach((u) => u());
    controllerUnsubs = [c.onAction((a) => get().controllerAction(a)), c.onDisconnect(() => set({ controllerConn: 'lost' }))];
    if (c instanceof ZwiftClickController) controllerUnsubs.push(c.onChange(() => set((s) => ({ controllerRev: s.controllerRev + 1 }))));
    set({ controller: c, controllerConn: 'connecting', error: null });
    try {
      await (c instanceof ZwiftClickController ? c.connect(source) : c.connect());
      set({ controllerConn: 'connected' });
      toast(`${c.name} connected`);
      rememberPods(c);
    } catch (e) {
      controllerUnsubs.forEach((u) => u());
      controllerUnsubs = [];
      set({ controller: null, controllerConn: 'disconnected', error: quiet ? get().error : errorMessage(e) });
    }
  };

  const initialProfile = loadProfile();

  return {
    profile: initialProfile,
    screen: 'home',
    trainer: null,
    conn: 'disconnected',
    error: null,
    sample: null,
    ride: null,
    lastRide: null,
    run: null,
    runSnap: null,
    outcome: null,
    celebrations: [],
    freeErg: { on: false, watts: clampErg(Math.round((initialProfile.ftp * 0.6) / 5) * 5) },
    controller: null,
    controllerConn: 'disconnected',
    gear: DEFAULT_GEAR,
    toast: null,
    todayPick: null,
    controllerRev: 0,
    remembered: loadRemembered(),
    autoStatus: {},
    hrm: null,
    hrmConn: 'disconnected',
    heartRate: null,

    setScreen: (screen) => set({ screen }),

    connectBluetooth: (name) => attach(new BluetoothTrainer(name ? { name } : {})),
    connectMock: () => attach(new MockTrainer()),

    reconnect: async () => {
      const { trainer, run, ride, freeErg } = get();
      if (!trainer) return;
      set({ conn: 'connecting', error: null });
      try {
        await trainer.connect();
        set({ conn: 'connected', ride: ride ? { ...ride, lastT: null } : ride });
        if (run) sendCommands(run.resume());
        else if (freeErg.on) sendCommands([{ type: 'erg', watts: freeErg.watts }]);
      } catch (e) {
        set({ conn: 'lost', error: errorMessage(e) });
      }
    },

    disconnect: async () => {
      const { trainer, run } = get();
      if (run) get().abortChallenge();
      if (get().ride) get().endRide();
      unsubs.forEach((u) => u());
      unsubs = [];
      await trainer?.disconnect().catch(() => undefined);
      ergOff();
      set({ trainer: null, conn: 'disconnected', sample: null });
    },

    startRide: () => {
      if (get().ride) return;
      keepScreenAwake(true);
      track = new TrackRecorder();
      set({
        ride: {
          startedAt: Date.now(),
          elapsedSec: 0,
          xp: 0,
          joules: 0,
          maxPower: 0,
          zoneSec: [0, 0, 0, 0, 0, 0, 0],
          stress: 0,
          hrBeats: 0,
          hrSec: 0,
          maxHr: 0,
          lastT: null,
          idleMs: 0,
          paused: false,
          challenges: [],
        },
        lastRide: null,
        screen: 'ride',
      });
    },

    endRide: () => {
      if (get().run) get().abortChallenge();
      const { ride, profile } = get();
      if (!ride) return;
      sendCommands([{ type: 'free' }]);
      ergOff();
      keepScreenAwake(false);
      const summary: RideSummary = {
        id: `${ride.startedAt}`,
        startedAt: ride.startedAt,
        durationSec: Math.round(ride.elapsedSec),
        kj: Math.round(ride.joules / 1000),
        avgPower: ride.elapsedSec > 0 ? Math.round(ride.joules / ride.elapsedSec) : 0,
        maxPower: ride.maxPower,
        zoneSec: ride.zoneSec.map(Math.round),
        xpEarned: Math.round(ride.xp),
        challenges: ride.challenges,
        tss: Math.round(ride.stress / 36),
        distanceM: Math.round(track.distance),
        ...(ride.hrSec >= 30 ? { avgHr: Math.round(ride.hrBeats / ride.hrSec), maxHr: ride.maxHr } : {}),
      };
      let next = profile;
      const statCelebrations: Celebration[] = [];
      if (ride.elapsedSec >= 60) {
        const stats = addStats(profile.stats, statGains(summary.zoneSec));
        for (const sys of SYSTEMS) {
          const before = statLevel(profile.stats[sys]).level;
          const after = statLevel(stats[sys]).level;
          if (after > before) statCelebrations.push({ kind: 'stat', system: sys, level: after });
        }
        next = { ...profile, rides: [...profile.rides, summary], stats };
        if (track.points.length) saveTrack({ rideId: summary.id, startedAt: ride.startedAt, points: track.points });
      }
      persist(next);
      set((s) => ({ ride: null, profile: next, lastRide: summary, celebrations: [...s.celebrations, ...statCelebrations] }));
    },

    startChallenge: (id) => {
      const { trainer, conn, profile, run } = get();
      const c = challengeById(id);
      if (!c) return;
      if (run) return set({ error: 'Finish the current challenge first.' });
      if (!trainer || conn !== 'connected') return set({ error: 'Connect your trainer first.' });
      const needsErg = c.steps.some((s) => s.mode === 'erg');
      if (needsErg && !trainer.capabilities.erg) {
        return set({
          error:
            "This trainer doesn't accept ERG control (FTMS). Update the KICKR firmware in the Wahoo app, and close any other app that is connected to it.",
        });
      }
      if (!get().ride) get().startRide();
      // The challenge takes over the trainer; free-ride ERG stays off afterwards.
      ergOff();
      const newRun = new ChallengeRun(c, profile.ftp);
      newRun.bonusId = todayBonusId(profile, get().todayPick);
      sendCommands(newRun.start());
      set({ run: newRun, runSnap: newRun.snapshot(), outcome: null, screen: 'ride' });
    },

    abortChallenge: () => {
      const run = get().run;
      if (!run) return;
      sendCommands(run.abort());
      if (run.done) finalizeRun(run);
      else set({ runSnap: run.snapshot() });
    },

    dismissOutcome: () => set({ outcome: null, runSnap: null }),

    rateWorkout: (feel) => {
      const { outcome, ride, profile, lastRide } = get();
      if (!outcome) return;
      const id = outcome.challenge.id;
      const tag = <T extends { id: string; feel?: Feel }>(list: T[]): T[] => {
        const i = list.map((c) => c.id).lastIndexOf(id);
        return i < 0 ? list : list.map((c, j) => (j === i ? { ...c, feel } : c));
      };
      if (ride) {
        set({ outcome: { ...outcome, feel }, ride: { ...ride, challenges: tag(ride.challenges) } });
        return;
      }
      // The ride already ended: tag it in the saved history.
      const rides = [...profile.rides];
      const last = rides[rides.length - 1];
      if (last) rides[rides.length - 1] = { ...last, challenges: tag(last.challenges) };
      const next = { ...profile, rides };
      persist(next);
      set({
        outcome: { ...outcome, feel },
        profile: next,
        lastRide: lastRide ? { ...lastRide, challenges: tag(lastRide.challenges) } : lastRide,
      });
    },
    dismissCelebration: () => set((s) => ({ celebrations: s.celebrations.slice(1) })),

    setFreeErg: (patch) => {
      const { run, trainer, conn, freeErg } = get();
      if (run) return;
      const next: FreeErg = {
        on: (patch.on ?? freeErg.on) && !!trainer?.capabilities.erg,
        watts: clampErg(patch.watts ?? freeErg.watts),
      };
      set({ freeErg: next });
      if (conn !== 'connected') return;
      if (next.on && (!freeErg.on || next.watts !== freeErg.watts)) sendCommands([{ type: 'erg', watts: next.watts }]);
      else if (!next.on && freeErg.on) sendCommands([{ type: 'free' }]);
    },

    updateProfile: (patch) => {
      const next = { ...get().profile, ...patch };
      if (patch.ftp != null && patch.ftp !== get().profile.ftp) {
        next.ftpHistory = [...next.ftpHistory, { at: Date.now(), ftp: patch.ftp }];
      }
      persist(next);
      set({ profile: next });
    },

    importJson: (json) => {
      try {
        const p = importProfile(json);
        persist(p);
        set({ profile: p, error: null });
      } catch (e) {
        set({ error: errorMessage(e) });
      }
    },

    exportJson: () => exportProfile(get().profile),

    resetProfile: () => {
      const p = defaultProfile();
      persist(p);
      set({ profile: p, celebrations: [] });
    },

    clearError: () => set({ error: null }),

    connectMockController: () => attachController(new MockController()),

    connectZwiftClick: async (name) => {
      const c = get().controller;
      if (c instanceof ZwiftClickController && get().controllerConn === 'connected') {
        try {
          await c.connect(name ? { name } : {}); // add the other side
          toast('Zwift controller added');
          rememberPods(c);
        } catch (e) {
          set({ error: errorMessage(e) });
        }
        return;
      }
      await attachController(new ZwiftClickController(), name ? { name } : {});
    },

    autoConnect: async () => {
      if (!canAutoReconnect()) return;
      const rem = loadRemembered();
      const status = (patch: GameState['autoStatus']) => set((st) => ({ autoStatus: { ...st.autoStatus, ...patch } }));

      const trainerTask = (async () => {
        if (!rem.trainer || get().trainer) return;
        const dev = await permittedDevice(rem.trainer.id);
        if (!dev) return;
        status({ trainer: `Looking for ${dev.name ?? rem.trainer.name}… switch it on or start pedalling.` });
        const near = await waitUntilNearby(dev, 60_000);
        status({ trainer: undefined });
        if (near && !get().trainer) await attach(new BluetoothTrainer({ device: dev }), true);
      })();

      const hrTask = (async () => {
        if (!rem.heartRate || get().hrm) return;
        const dev = await permittedDevice(rem.heartRate.id);
        if (!dev) return;
        status({ heartRate: `Looking for ${dev.name ?? rem.heartRate.name}… put it on to wake it.` });
        const near = await waitUntilNearby(dev, 120_000);
        status({ heartRate: undefined });
        if (near && !get().hrm) await attachHeartRate(new HeartRateMonitor({ device: dev }), true);
      })();

      // Pods connect one at a time: the first creates the controller, later ones join it.
      let chain = Promise.resolve();
      const podTasks = rem.shifters.map(async (r) => {
        const dev = await permittedDevice(r.id);
        if (!dev) return;
        status({ shifters: 'Press a button on your Zwift Click to connect it.' });
        const near = await waitUntilNearby(dev, 120_000);
        if (!near) return;
        chain = chain.then(async () => {
          const c = get().controller;
          if (c instanceof ZwiftClickController && get().controllerConn === 'connected') {
            if (c.podInfo.some((p) => p.id === dev.id && p.state === 'connected')) return;
            await c.connect({ device: dev }).then(() => rememberPods(c)).catch(() => undefined);
          } else if (!c) {
            await attachController(new ZwiftClickController(), { device: dev }, true);
          }
        });
        await chain;
      });
      await Promise.all([trainerTask, hrTask, Promise.all(podTasks).finally(() => status({ shifters: undefined }))]);
    },

    connectHeartRate: (name) => attachHeartRate(new HeartRateMonitor(name ? { name } : {})),
    connectMockHeartRate: () => attachHeartRate(new MockHeartRate(() => get().sample?.power ?? 0)),
    disconnectHeartRate: async () => {
      const m = get().hrm;
      hrUnsubs.forEach((u) => u());
      hrUnsubs = [];
      await m?.disconnect().catch(() => undefined);
      set({ hrm: null, hrmConn: 'disconnected', heartRate: null });
    },

    forgetDevices: (kind) => {
      if (kind === 'trainer') forgetTrainer();
      else if (kind === 'heartRate') forgetHeartRate();
      else forgetShifters();
      set({ remembered: loadRemembered() });
    },

    disconnectController: async () => {
      const c = get().controller;
      controllerUnsubs.forEach((u) => u());
      controllerUnsubs = [];
      await c?.disconnect().catch(() => undefined);
      set({ controller: null, controllerConn: 'disconnected' });
    },

    setTodayPick: (todayPick) => set({ todayPick }),

    controllerAction: (a) => {
      const { run, freeErg, conn, profile, celebrations, outcome, todayPick } = get();
      const refresh = () => set({ runSnap: run!.snapshot() });

      switch (a) {
        case 'shiftUp':
        case 'shiftDown': {
          const dir = a === 'shiftUp' ? 1 : -1;
          if (run?.ergActive) {
            if (!run.adjustable) return toast('Targets are fixed during challenges');
            sendCommands(run.nudgeWatts(5 * dir));
            refresh();
            const s = run.snapshot();
            return toast(`Target ${s.targetWatts} W (${s.offsetW >= 0 ? '+' : ''}${s.offsetW} W)`);
          }
          if (!run && freeErg.on) {
            get().setFreeErg({ watts: freeErg.watts + 5 * dir });
            return toast(`ERG ${get().freeErg.watts} W`);
          }
          const gear = clampGear(get().gear + dir);
          set({ gear });
          if (conn === 'connected') sendCommands([{ type: 'free' }]);
          return toast(`Gear ${gear}`);
        }
        case 'harder':
        case 'easier': {
          const dir = a === 'harder' ? 1 : -1;
          if (run) {
            if (!run.adjustable) return toast('Targets are fixed during challenges');
            sendCommands(run.adjustIntensity(5 * dir));
            refresh();
            return toast(`Intensity ${run.snapshot().intensityPct}%`);
          }
          if (freeErg.on) {
            get().setFreeErg({ watts: freeErg.watts + 10 * dir });
            return toast(`ERG ${get().freeErg.watts} W`);
          }
          return get().controllerAction(dir > 0 ? 'shiftUp' : 'shiftDown');
        }
        case 'skip': {
          if (!run) return;
          if (!run.adjustable) return toast("You can't skip steps in a challenge");
          sendCommands(run.skip());
          if (run.done) return finalizeRun(run);
          refresh();
          return toast(`Skipped to ${run.snapshot().step.label}`);
        }
        case 'pause':
        case 'resume': {
          if (!run) return;
          if (!run.adjustable) return toast("Challenges can't be paused");
          // One "pause" button toggles; an explicit "resume" always resumes.
          const pause = a === 'pause' && !run.snapshot().manualPause;
          sendCommands(run.setPaused(pause));
          refresh();
          return toast(pause ? 'Paused' : 'Resumed');
        }
        case 'select': {
          if (celebrations.length) return get().dismissCelebration();
          if (outcome) return get().dismissOutcome();
          if (run || conn !== 'connected') return;
          const suggestion = suggestToday({ ...profile });
          const id = todayPick?.suggestionId === suggestion.workout.id ? todayPick.workoutId : suggestion.workout.id;
          get().startChallenge(id);
          return toast(`Starting ${challengeById(id)?.name ?? 'ride'}`);
        }
      }
    },
  };
});

function errorMessage(e: unknown): string {
  if (e instanceof DOMException && e.name === 'NotFoundError') return 'No device selected.';
  if (e instanceof Error) return e.message;
  // Some browsers (e.g. Bluefy on iOS) reject with bare codes; say where it came from.
  console.warn('Bluetooth error', e);
  return `Bluetooth error: ${typeof e === 'object' ? JSON.stringify(e) : String(e)}`;
}

// Dev-only handle for debugging in the console: `game.getState()`.
if (import.meta.env.DEV) (globalThis as unknown as { game: typeof useGame }).game = useGame;
