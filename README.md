# Climbing Trainer PWA

A tiny offline-first training app, built as an installable web app so it runs on iPhone without an Apple developer account. Companion to the (Android-only) climbing-trainer app — same block-picker concept, radically smaller.

**Live:** https://erikbros.github.io/climbing-pwa/

## What it does

- **Block picker** — choose which training blocks to do today (Pull, Push & Shoulder, Core, Hips, Shoulder mobility, Prehab), expand any block (▸) to preview its exercises, see the estimated total time, start.
- **Hide blocks** — expand a bundled block (▸) → "Hide this block" removes it from the picker and week planner (and strips it from existing plans); a collapsed "Hidden blocks" row at the bottom restores them anytime. Custom blocks are deleted via ✎ instead.
- **Custom blocks** — "＋ Create your own block": compose a block from a categorized exercise library (pull / push / core / legs / hips / shoulders / prehab, ~20 extra exercises beyond the bundled blocks). Custom blocks are editable/deletable (✎) and work in the weekly plan.
- **Last-time paste** — each exercise shows an `↻ last` chip with the previous session's reps/kg; one tap pastes them into the current session's sets. Inputs also show last-time values as placeholders.
- **Session view** — exercises with target sets/reps/load and coaching cues; tap ✓ per set; reps/kg editable per set (load prefills from your last session).
- **Timers** — timed exercises get a full-screen countdown (3s prep, per-side switch handled automatically, ±15s/pause/skip); completing a set starts a rest countdown with ±15s, pause and skip. Audio ticks at 3-2-1 and a done-tone, screen stays awake during timers. Work and rest durations are editable in-session via the `work`/`rest` chips on each exercise — edits persist as per-exercise overrides for future sessions.
- **Weekly plan** — plans are per calendar week (ISO-week keyed), not a recurring template: plan this week, flip to next week to plan ahead, and when a fresh week starts it's blank with a one-tap "Copy last week's plan". Day rows show only their planned blocks (tap `✕` to remove) plus a `＋ add` chip that expands that day's available-blocks list — scales cleanly as custom blocks accumulate. Past days dim; the Train picker pre-fills from today's entry in this week's plan (deviations on the day are free and never write back). Old weeks are pruned after ~8 weeks.
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
