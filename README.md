# Climbing Trainer PWA

A tiny offline-first training app, built as an installable web app so it runs on iPhone without an Apple developer account. Companion to the (Android-only) climbing-trainer app — same block-picker concept, radically smaller.

**Live:** https://erikbros.github.io/climbing-pwa/

## What it does

- **Block picker** — choose which training blocks to do today (Pull, Push & Shoulder, Core, Hips, Shoulder mobility, Prehab), see the estimated total time, start.
- **Session view** — exercises with target sets/reps/load and coaching cues; tap ✓ per set; reps/kg editable per set (load prefills from your last session).
- **Timers** — timed exercises get a full-screen countdown (3s prep, per-side switch handled automatically); completing a set starts a rest countdown with ±15s and skip. Audio ticks at 3-2-1 and a done-tone, screen stays awake during timers.
- **History** — past sessions, expandable to set detail; one-tap JSON export (share sheet on iOS).
- **Fully offline** — service worker caches everything on first visit. All data stays in the phone's local storage. No server, no accounts, no tracking.

## Install on iPhone

1. Open the live URL in **Safari** (must be Safari).
2. Tap **Share → Add to Home Screen**.
3. Launch from the home-screen icon. Done — works offline from now on.

> Data lives on the device. Deleting the app from the home screen after clearing Safari website data will delete history — use Export now and then.

## Editing the plan

The whole training plan is `schedule.json` — blocks → exercises with `metric` (`REPS` | `REPS_LOAD` | `TIME`), `sets`, `reps`/`duration_sec`, `rest_sec`, optional `per_side`, and a coaching `cue`.

To ship a change:

1. Edit `schedule.json` (or any file).
2. **Bump `CACHE_VERSION` in `sw.js`** — installed phones only pick up changes when the cache name changes.
3. `git push` — GitHub Pages redeploys automatically. The phone updates next time the app is opened with internet (may take one extra open).

## Stack

None. Vanilla HTML/CSS/JS, no build step, no dependencies. `make_icons.py` (Pillow) regenerates the icons.
