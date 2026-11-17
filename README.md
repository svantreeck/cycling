# Cadence Quest ⚡

**Indoor cycling as an RPG, with a coach that plans your training.** Cadence Quest runs in the browser and connects
straight to a Bluetooth smart trainer and handlebar shifters. There's nothing to install, and you don't need an account
or a subscription.

**Ride it:** <https://svantreeck.github.io/cycling/>

## What it does

- **Levels and an avatar that gears up:** every minute you ride earns XP, and harder zones earn more. Your avatar's bike
  and kit improve as you level up, and it looks fresh or worn out depending on your recent training load.
- **Fitness stats:** Endurance, Tempo, Threshold, VO₂max and Anaerobic level up based on time spent in each power zone.
- **A coach that suggests today's ride:** set a goal (general fitness, base, raise FTP or an event) and the days you can
  ride. The coach picks each day's workout from your fitness, fatigue and form, and the Shorter / Easier / Harder
  buttons swap it. Riding the suggestion earns a ×1.5 XP bonus.
- **Training blocks and promotions:** training runs in 4-week blocks (3 build weeks and 1 recovery week), ending with an
  FTP ramp test. Passing it promotes you to the next rank.
- **Over 40 structured workouts:** Zone 2, tempo, sweet spot, threshold, VO₂max, anaerobic and sprint sessions, plus
  pass/fail challenges. The trainer holds the target watts (ERG mode). Workouts adapt to how hard you say they felt.
- **Free ride with virtual gears:** 24 virtual gears that behave like a real cassette. Each shift changes how far a pedal stroke takes you, and the speed shown follows. Shift them with a Zwift Click or
  the keyboard.
- **Heart rate:** pair a Bluetooth heart-rate monitor to see it live during rides. Average and max appear in the ride
  summary, and heart rate is included in exported rides.
- **Export your rides:** each ride is recorded second by second and can be exported as a `.tcx` file. Upload it to
  Strava, intervals.icu, TrainingPeaks or Garmin Connect.

## Hardware

| Device | Status |
| --- | --- |
| Wahoo KICKR CORE (v2) | ✅ Tested: ERG, simulation grade, power, cadence, speed |
| Zwift Click v2 (firmware 1.2) | ✅ Tested: shifting, workout controls, battery |
| Other smart trainers that use the standard Bluetooth FTMS protocol (most current Wahoo, Tacx, Elite, Saris and JetBlack models) | Should work, untested |
| Power meters or trainers with only the Bluetooth Cycling Power service | Should work read-only (no ERG), untested |
| Zwift Ride and Zwift Play controllers, original Zwift Click | Same protocol family, untested |
| Heart-rate monitors using the standard Bluetooth Heart Rate service (chest straps, arm bands, watches broadcasting HR) | Should work: shown live and saved in exported rides |

If you try something on the untested list, please open an issue to say whether it worked.

### Browsers

Cadence Quest needs **Web Bluetooth**:

- **Mac, Windows, Linux, Android:** Chrome or Edge.
- **iPad or iPhone:** Safari doesn't support Web Bluetooth, so use the free [Bluefy](https://apps.apple.com/app/id1492822055)
  browser.
- **Firefox:** not supported.

### Connecting

1. Close Zwift, the Wahoo app and anything else connected to the trainer. A trainer accepts only one controlling app at
   a time.
2. Click **Connect trainer** and pick it from the list.
3. Optional, for Zwift Clicks: if they are paired to your trainer (for example through the KICKR CORE's Zwift bridge),
   unpair them there first. Press a button on the right (+) side to wake it, click **Connect Zwift Click**, then
   **Add other side**.
   - The right side always works: **+** shifts up and **B** shifts down.
   - The left side may need to be unlocked by the Zwift app every so often. Without that it stops after about a minute,
     and Cadence Quest reconnects it automatically.
4. Optional: connect a heart-rate monitor. Wear it first so it wakes up.
5. Next time, the app remembers your devices and offers one-tap **Reconnect** buttons. Chrome can also reconnect them
   automatically if you enable `chrome://flags/#enable-web-bluetooth-new-permissions-backend`.

There's also a built-in **simulator** (trainer and controller) if you want to look around without a bike.

## Your data

Everything stays in your browser's local storage. There are no accounts, servers or analytics. Clearing your browser
data deletes your progress, so use **Profile → Export backup** now and then. Nothing is uploaded anywhere unless you
upload a ride file yourself.

## Development

You need Node 24 or later.

```sh
npm install
npm run dev     # local dev server at http://localhost:5173
npm test        # unit tests (vitest)
npm run build   # type-check and production build into dist/
```

Every push to `main` builds the app and deploys it to GitHub Pages with
[.github/workflows/deploy.yml](.github/workflows/deploy.yml).

Main areas of the code:

| Path | What's there |
| --- | --- |
| `src/ble/` | Bluetooth: FTMS and Cycling Power trainers, the Zwift controller protocol, the simulator |
| `src/game/` | Workouts and challenges, the challenge engine, the coach (training load, blocks, suggestions), XP and stats |
| `src/store/` | App state (zustand) and saving to local storage |
| `src/strava/` | Ride recording and `.tcx` export |
| `src/components/` | React UI |

## Disclaimers

- Cadence Quest is an independent hobby project. It is **not affiliated with, endorsed by or sponsored by** Zwift, Wahoo,
  Strava, Garmin, TrainingPeaks or any other company it mentions.
  - Zwift, Zwift Click, Zwift Ride and Zwift Play are trademarks of Zwift, Inc. Wahoo and KICKR are trademarks of Wahoo
    Fitness. Strava is a trademark of Strava, Inc.
  - Other names are trademarks of their owners and appear only to describe compatibility.
- Zwift controller support was written from publicly documented, community reverse-engineered protocol descriptions. It
  contains no code or assets from Zwift or other apps. It doesn't bypass the controllers' Zwift unlock.
- Training guidance in the app is general information, not medical advice. Check with a doctor before starting hard
  training, and stop if something feels wrong.

## License

[BSD 3-Clause](LICENSE) © 2026 Steve van Treeck.
