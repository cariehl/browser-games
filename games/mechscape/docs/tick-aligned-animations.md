# Plan: tick-aligned animations

**Status:** done for the loader and the sentry. The player's swing clips wait for the player model; its upper-body layer is built and tested on the loader rig.

What was built, for reference:
- **Blender (`ms_lib.py` in `art_src/MechScape_Models.blend`):** `FPS`, `TICK_FRAMES` and `GRID`; `retime_action()` (resamples a clip onto a new timeline); `set_strike()` (the `strike` marker); and `check_timing()`, which `export_glb()` now runs before every animated export. The pre-30 fps file is kept as `art_src/MechScape_Models_pre30fps.blend`.
- **Sim:** `Combat.commit()` / `Combat.impact()`, `PendingHit` and `World.pending_hits`, saved since save version 4.
- **View:** `ModelAnimator` holds every swing to the tick clock (`_swing_time()`), so the strike frame lands on the hitsplat even with slow or uneven frames. `enable_upper_body()` turns on the upper-body layer. `NpcDef.attack_windup_frames` is 9 for the loader and 18 for the sentry.
- **Tests:** `tests/animation_test.gd`, plus new cases in the combat and save tests.

## Rules

1. **Blender runs at 30 fps, so one tick (`GameLoop.TICK_SECONDS` = 0.6 s) is 18 frames.**
2. **Clip lengths are multiples of 3 frames.** Snap each length to the nearest multiple of 3. The exception: if a whole tick (a multiple of 18) is within 3 frames, use that instead. For example, 20 frames snaps to 18, not 21.
3. **Attacks are anchored on the strike.** The strike is the frame where the blow lands or the shot fires. It plays at the exact moment the hitsplat appears, which is the start of the tick the hit resolves on.
   - **Wind-up** is the part before the strike. It's a multiple of 3 frames, at most 18 (one tick), so the attack starts during the tick before the hit.
   - **Follow-through** is the part after the strike. It's also a multiple of 3 frames.
4. **Attacks are committed one tick early, and a committed attack always lands.** An attack is decided on the tick before its strike: damage is rolled, ammo is spent and the XP drop appears then. The hitsplat appears on the strike frame, or later when a projectile connects once projectiles exist. Nothing undoes a committed attack: not the attacker moving, and not the target moving away. This applies to every attacker. Players and NPCs both follow it.
5. **Moving never changes the outcome, only the animation.** The XP drop and the hitsplat always happen on schedule.
   - **NPCs:** moving during the wind-up or the follow-through blends Attack into Walk.
   - **Players:** they finish the swing while walking. The legs play Walk while the torso and arms play the rest of Attack on an upper-body layer.

Clips no longer have to be whole ticks long. Walk keeps its current speed matching, and idles keep playing freely.

## Current clips and proposed lengths

Lengths are in frames. The "@30" column is the current length converted to 30 fps (×1.25).

| Model | Clip | Now @24 | @30 | Proposed | Notes |
|---|---|---|---|---|---|
| Loader | Idle | 48 | 60 | **60** | already a multiple of 3 |
| | IdleBob | 40 | 50 | **51** | 54 (3 ticks) is 4 away |
| | Walk | 32 | 40 | **39** | still speed-matched at runtime |
| | Death | 30 | 37.5 | **36** | 2 ticks |
| | Attack | 36 | 45 | **9 + 36 = 45** | wind-up 10 → 9, follow-through 35 → 36 |
| Sentry | Idle | 48 | 60 | **60** | |
| | IdleBob | 40 | 50 | **51** | |
| | Walk | 32 | 40 | **39** | |
| | Death | 30 | 37.5 | **36** | |
| | Attack | 30 | 37.5 | **18 + 18 = 36** | wind-up ≈17 → 18, follow-through ≈20.5 → 18 |

### Where the strike is

**Loader:** the attack is a 4-round burst, alternating guns. The muzzle flashes peak at frames 8, 12, 16 and 20 @24 (10, 15, 20 and 25 @30).
- **Decided:** the strike is the **first** round. The hitsplat appears as the burst opens, and the other three rounds are follow-through.
- To keep the rounds evenly spaced on the new grid, retime them to frames 9, 15, 21 and 27 @30 (every 6 frames).

**Sentry:** a two-arm swing. The keys suggest the impact is around frame 13.6 @24 (≈17 @30), just before a short hold. **Confirm this in Blender** before snapping it to 18. With wind-up and follow-through both 18, the whole swing is exactly 2 ticks: the first tick is the wind-up and the second is the follow-through.


## Sim change: committed attacks

**How it works today:** in `AttackTask.process`, when the cooldown allows an attack, `Combat.attack` rolls the damage, grants XP and emits `attack` and `hit` on the same tick. The hitsplat (`view/combat_overlay.gd`, on `hit`) and the attack animation (`ModelAnimator`, on `attack`) both start then. The strike therefore lands *after* the hitsplat, partway through the clip.

**Proposed change:** `Combat.attack` splits into two steps.

1. **Commit, on tick T−1.** This runs when the attacker is in reach and `world.tick + 1 >= next_attack_tick`.
   - It rolls damage, spends ammo, grants XP and sets `next_attack_tick = T + speed`.
   - It emits `attack {attacker, target, strike_tick: T}`.
   - It schedules the impact. The impact is held in a world-level list of pending hits, not in the task, so a later move order that clears the task doesn't touch it.
2. **Impact, on tick T** (later, for projectiles).
   - It applies the damage and emits `hit`, which shows the hitsplat.
   - It then handles death and retaliation, as now.
   - It lands whether the target or the attacker has moved since.
   - If the target died or despawned in the meantime, it's dropped.

Other effects:
- **Rhythm.** Hitsplats still come every `speed` ticks: a blade still hits every 4 ticks and a pistol every 3. The only new delay is one tick before the *first* hit of a fight.
- **Healing.** The injector's attack delay pushes back the *next* commit. An attack already committed still lands.
- **Damage rolled at commit** is capped by the target's HP at that moment. If someone else damages the target before the impact, the hit is capped again when it's applied. XP is based on the commit roll, as in RuneScape.
- **The sim doesn't know about animations.** Every attacker gets the same one-tick commit, however long its wind-up animation is. The view decides when to start the clip inside that tick.
- **Saving.** Pending hits are saved, with a save version bump, because their XP has already been granted.
- **Ready for projectiles.** A projectile weapon just schedules its impact further out, based on travel time. Nothing else changes.

## View changes

`ModelAnimator`:
- **On `attack`:** schedule Attack to begin `18 − windup` frames into the commit tick, so its strike lands as tick T starts. The loader starts 0.3 s into the tick; the sentry starts right on it.
- **Moving:** for NPCs, any movement during the clip blends Attack into Walk, as "moving always wins" does now. For models that support it (the player), Attack carries on over Walk on the upper body instead. See the next section.
- **Resync:** on the strike tick, if the clip is still playing but has drifted by more than one frame, seek it to the strike frame.
- **The wind-up per model** has to live somewhere Godot can read, because glTF doesn't export Blender markers. Add an `attack_windup_frames` field to the Model group of `NpcDef`, and to the weapon type for the player later. In Blender, a `strike` pose marker on each Attack action records the same value. The export guard checks the two agree.

Elsewhere:
- **XP drop:** it appears on the first wind-up frame. The sim grants XP at the start of the commit tick, so the view holds the XP drop popup for `18 − windup` frames to line it up. Without a wind-up value (the player, until it has a model) it shows at the start of the commit tick.
- **Hitsplat:** no change. `combat_overlay` still shows it on `hit`.
- **Placeholder lunge:** box-drawn entities, which includes the player for now, move the lunge from `attack` to `hit`, so it stays in step with the hitsplat.

## Player swings (when the player model exists)

These follow the same rules: a wind-up of at most one tick before the strike, and a follow-through after it.
- Weapon attack speed doesn't change. Blades still hit every 4 ticks and pistols every 3.
- The XP drop and the hitsplat always happen, whatever the player does after the commit.
- Each weapon type gets its own Attack clip, or one clip per type. Its wind-up is stored on the weapon type def, so a pistol can have a short wind-up and a heavy blade a long one.
**Finishing swings while walking:**
- `ModelAnimator` gets an optional upper-body mode. When it's on, it drives the model through an `AnimationTree`: a `Blend2` node mixes a full-body clip with an upper-body clip, filtered to the bones from the spine root up.
- Standing still, Attack plays on the whole body. Moving starts Walk underneath, and Attack keeps playing on the upper body until it ends. The upper body then blends back to Walk.
- The NPCs stay on the plain `AnimationPlayer` path.
- **Rig requirement:** the player rig needs one clean spine root bone to split on. Build it that way from the start.
- Until the player model exists, the mode is built and tested on the loader rig, then switched off for NPCs.

## Checks

- **Blender export guard (`export_glb`):**
  - The scene is 30 fps.
  - Every NLA strip is a multiple of 3 frames long.
  - Every Attack action has a `strike` marker on a multiple of 3, with a wind-up of at most 18 frames and a follow-through that is a multiple of 3.
- **`tests/animation_test.gd` (new):**
  - Every clip in every `.glb` is a whole number of 3-frame steps long (0.1 s, within 1 ms).
  - Every NPC def whose model has an Attack clip has an `attack_windup_frames` value that is a multiple of 3, at most 18, and shorter than the clip.
- **`tests/combat_test.gd`:**
  - `attack` (with the XP) comes one tick before `hit`.
  - A move order right after the commit doesn't stop the hit.
  - A target stepping out of reach after the commit still gets hit.
  - A target killed by someone else before the impact drops the hit.
  - Hits still come every `speed` ticks once a fight is under way.
- **`tests/save_test.gd`:** a pending hit survives a save and lands after loading.
- **`tests/splicing_test.gd`:** update the injector timing test for the extra wind-up tick. Injecting after a commit doesn't stop that hit, but it does delay the next one.
- **`_check/collapse.tscn`:** still passes. The collapse is now 36 frames (1.2 s).

## Order of work

1. **Sim:** commit and impact, pending hits (saved), and the tests. This is a gameplay change, so it goes first and is playable with the current models and the lunge.
2. **`ms_lib.py`:** 30 fps, lengths in frames on the 3-frame grid, the `strike` marker and the export guard.
3. **Rebuild clips** for the loader and the sentry at the lengths above. Retime the loader's burst, and confirm the sentry's impact frame.
4. **Re-export** both models into `assets/models/`, and set `attack_windup_frames` (loader 9, sentry 18).
5. **View:** `ModelAnimator` attack scheduling and resync, the upper-body mode (tested on the loader rig), the delayed XP drop, and the lunge moved to `hit`.
6. **Run everything:** all test suites, the loop check, `_check/all.tscn`, `_check/collapse.tscn`, and a short capture of a fight to judge the timing.

## Decisions

- **Loader burst:** the hitsplat lands on the first round.
- **No cancelling:** a committed attack always lands, whoever moves.
- **XP drop:** it comes on the first wind-up frame, before the hitsplat.
- **Moving:** it never changes the outcome. NPCs blend to Walk; players finish the swing on the upper body while walking.
