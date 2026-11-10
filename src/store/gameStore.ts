import { create } from 'zustand';
import { BluetoothTrainer } from '../ble/ftms';
import { MockTrainer } from '../ble/mockTrainer';
import type { Trainer, TrainerSample, Unsubscribe } from '../ble/trainer';
import { tiersReached, type AvatarTier } from '../game/avatarTiers';
import { ChallengeRun, type RunResult, type RunSnapshot, type TrainerCommand } from '../game/challengeEngine';
import { challengeById, dailyBounty, RAMP_TEST, type Challenge } from '../game/challenges';
import { challengeReward } from '../game/rewards';
import { addXp, clearPromotion, isBlockedAtGate, rideXp, xpToNext, type AddXpResult } from '../game/xp';
import { zoneFor } from '../game/zones';
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

export interface LiveRide {
  startedAt: number;
  elapsedSec: number;
  xp: number;
  /** watt-seconds (J) */
  joules: number;
  maxPower: number;
  zoneSec: number[];
  lastT: number | null;
  idleMs: number;
  paused: boolean;
  challenges: { id: string; passed: boolean; xp: number }[];
}

export type Celebration =
  | { kind: 'levelUp'; levels: number[]; tiers: AvatarTier[] }
  | { kind: 'gate'; level: number };

export interface RunOutcome {
  challenge: Challenge;
  result: RunResult;
  xp: number;
  lines: string[];
  oldFtp: number;
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

  setScreen(s: Screen): void;
  connectBluetooth(): Promise<void>;
  connectMock(): Promise<void>;
  reconnect(): Promise<void>;
  disconnect(): Promise<void>;
  startRide(): void;
  endRide(): void;
  startChallenge(id: string): void;
  abortChallenge(): void;
  dismissOutcome(): void;
  dismissCelebration(): void;
  updateProfile(patch: Partial<Pick<Profile, 'name' | 'ftp' | 'cosmetics' | 'settings'>>): void;
  importJson(json: string): void;
  exportJson(): string;
  resetProfile(): void;
  clearError(): void;
}

export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The day's bounty, or undefined if already claimed today. */
export function activeBounty(profile: Profile): Challenge | undefined {
  if (profile.bountyClaimedOn === localDate()) return undefined;
  return dailyBounty(profile.levels.level);
}

let unsubs: Unsubscribe[] = [];
let lastSave = 0;

export const useGame = create<GameState>((set, get) => {
  const persist = (profile: Profile) => {
    saveProfile(profile);
    lastSave = Date.now();
  };

  const sendCommands = (cmds: TrainerCommand[]) => {
    const t = get().trainer;
    if (!t) return;
    for (const c of cmds) {
      const p = c.type === 'erg' ? t.setErgPower(c.watts) : t.setFreeRide();
      p.catch((e) => console.warn('Trainer command failed', c, e));
    }
  };

  /** Fold an addXp/clearPromotion result into state, queueing celebrations. */
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
    // Announce the gate once: the first time the bar fills, not on every sample while capped.
    const wasCapped = isBlockedAtGate(before) && before.xp >= xpToNext(before.level);
    if (res.hitGate && !wasCapped) celebrations.push({ kind: 'gate', level: res.state.level });
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
    const bounty = activeBounty(profile);
    const isBounty = bounty?.id === challenge.id;
    const reward = challengeReward({
      challenge,
      result,
      previousCompletions: record.count,
      isBounty,
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
    if (result.passed && isBounty) next.bountyClaimedOn = localDate();
    if (result.passed && result.newFtp && challenge.id === RAMP_TEST.id) {
      next.ftp = result.newFtp;
      next.ftpHistory = [...next.ftpHistory, { at: Date.now(), ftp: result.newFtp }];
    }
    if (result.passed && challenge.promotionFor != null) {
      next = applyLevelResult(next, clearPromotion(next.levels, challenge.promotionFor));
    }
    if (reward.xp > 0) next = applyLevelResult(next, addXp(next.levels, reward.xp));

    persist(next);
    set({
      profile: next,
      run: null,
      runSnap: snap,
      outcome: { challenge, result, xp: reward.xp, lines: reward.lines, oldFtp: profile.ftp },
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
          xp: ride.xp + gained,
        };
        if (gained > 0) profile = applyLevelResult(profile, addXp(profile.levels, gained));
      }
    }

    set({ sample, ride, profile });

    const run = get().run;
    if (run) {
      sendCommands(run.update(sample));
      if (run.done) finalizeRun(run);
      else set({ runSnap: run.snapshot() });
    }

    if (Date.now() - lastSave > AUTOSAVE_MS) persist(get().profile);
  };

  const attach = async (trainer: Trainer) => {
    unsubs.forEach((u) => u());
    unsubs = [];
    set({ trainer, conn: 'connecting', error: null });
    unsubs.push(trainer.onSample(handleSample));
    unsubs.push(
      trainer.onDisconnect(() => {
        set({ conn: 'lost' });
      }),
    );
    try {
      await trainer.connect();
      set({ conn: 'connected' });
    } catch (e) {
      unsubs.forEach((u) => u());
      unsubs = [];
      set({ trainer: null, conn: 'disconnected', error: errorMessage(e) });
    }
  };

  return {
    profile: loadProfile(),
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

    setScreen: (screen) => set({ screen }),

    connectBluetooth: () => attach(new BluetoothTrainer()),
    connectMock: () => attach(new MockTrainer()),

    reconnect: async () => {
      const { trainer, run, ride } = get();
      if (!trainer) return;
      set({ conn: 'connecting', error: null });
      try {
        await trainer.connect();
        set({ conn: 'connected', ride: ride ? { ...ride, lastT: null } : ride });
        if (run) sendCommands(run.resume());
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
      set({ trainer: null, conn: 'disconnected', sample: null });
    },

    startRide: () => {
      if (get().ride) return;
      set({
        ride: {
          startedAt: Date.now(),
          elapsedSec: 0,
          xp: 0,
          joules: 0,
          maxPower: 0,
          zoneSec: [0, 0, 0, 0, 0, 0, 0],
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
      };
      const next = ride.elapsedSec >= 60 ? { ...profile, rides: [...profile.rides, summary] } : profile;
      persist(next);
      set({ ride: null, profile: next, lastRide: summary });
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
      const newRun = new ChallengeRun(c, profile.ftp);
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
    dismissCelebration: () => set((s) => ({ celebrations: s.celebrations.slice(1) })),

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
  };
});

function errorMessage(e: unknown): string {
  if (e instanceof DOMException && e.name === 'NotFoundError') return 'No trainer selected.';
  return e instanceof Error ? e.message : String(e);
}

// Dev-only handle for debugging in the console: `game.getState()`.
if (import.meta.env.DEV) (globalThis as unknown as { game: typeof useGame }).game = useGame;
