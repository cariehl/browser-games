# MechScape (three.js)

A tick-based MMO prototype in the browser: RuneScape's structure, with guns, mechs and future tech. This is the three.js rebuild of the Godot MVP (`D:\Projects\Godot\Projects\mechscape`), with the same map, content, models and rules, and the same 0.6 s tick. The Godot project is untouched.

## Running it

You need [Node.js](https://nodejs.org) 22 or newer (Colyseus 0.18 requires it). The game is multiplayer: one Node server runs the world and everyone plays in it from a browser.

```
npm install
npm start
```

Then open <http://localhost:2567>, pick a pilot name and play. Friends open `http://<your address>:2567` and pick their own names (see [Multiplayer](#multiplayer) for hosting). `npm run dev` does the same with the debug cheats allowed.

To play alone without a server, `npm run offline` serves the files and you open <http://localhost:8000/?offline>. That runs the whole sim in the page, with local saves, as before. Any static file server works for this (`python -m http.server 8000`, for one); browsers just won't load ES modules from a `file://` URL, so double-clicking `index.html` doesn't work.

The page has no build step. three.js 0.170.0 is vendored in `vendor/three/` (only the files the game uses) and loaded with an import map in `index.html`; the Colyseus browser client is vendored in `vendor/colyseus/` (`npm run vendor-sdk` copies it again after an upgrade).

Controls:
- **Mouse:** hover over an NPC, node or station to see what a left click does ("Attack Loader mech", "Salvage Crashed drone"). Left-click does it; left-click open ground to walk there.
- **Right-click:** anything for its options: the action, Walk here, **Inspect** (a card of its stats and your odds against it, for things that have stats), **Examine** (its description, in the chat box on the next tick) and Cancel. Right-click an inventory item for Wield or Wear, Drop, Inspect and Examine, and a recipe in a crafting station's menu to make it or Inspect and Examine what it makes; hovering an item shows its left-click action and stats.
- **Keys:** **R** toggles run; middle-drag or the arrow keys orbit the camera; scroll to zoom.

Clicks land on what's drawn: NPCs, nodes and stations have hitboxes that move with their models, so you click the mech, not the tile under it. **F5** shows the hitboxes.

The map is the Scrapyard, 64 × 48 tiles. From west to east:

- **Camp:** where you start, inside a fence with gates on every side. The weapons bench, metal press, bio-still, storage locker and manufactory are here.
- **Drone field:** just south-west of camp, crashed drones to salvage, with wrecked haulers (Salvaging 5) on its outskirts.
- **The long wall:** runs north–south, with three gaps.
- **Sentry ruins:** east of the middle gap, relic sentries among broken walls.
- **Loader yard:** in the north-east, a fenced compound of mech hulls guarded by loader mechs. Rustcap (Xenobiology 10) grows among them.
- **The Pit:** south of the sentry ruins, breacher mechs (about level 15) guarding glowroot tangles (Xenobiology 15).
- **Vent fields:** in the far south-east, gas vents in a rocky basin, coolant leaks (Siphoning 10) at its edges and ichor wellsprings (Siphoning 15) on the far east rim. Siphoning is the most AFK skill, so it's the furthest from spawn.

Salvaging: click a wreck to walk up to it and salvage. Crashed drones (orange-brown, in the drone field) need level 1 and give scrap metal; derelict mech hulls (blue-gray, in the loader yard) need level 10 and give alloy plating. Each successful collection has a chance to strip the wreck bare; it comes back after a few seconds.

Siphoning: click a gas vent (glowing green, in the vent fields) to siphon vent gas. You need a **canister** to siphon into: press one at the metal press from 2 scrap metal. Each canister holds 50 gas in one inventory slot; when it's full, siphoning moves on to the next empty canister, and stops when they're all full. Vents never run dry, so canisters are what limit an AFK session: carry more for longer. Using the last gas in a canister gives you the empty canister back.

Engineering: one skill for everything you make from metal, at two stations near spawn. Click a station to walk up to it and open its menu. Each recipe shows its level and materials, red where you're short; pick 1, 5 or All. Stations that make more than one kind of thing sort their recipes into tabs (Weapons, Armor, Supplies), and a long tab scrolls. Clicking elsewhere stops crafting. The level to make something stays close to the level to use it (alloy gear: Engineering 10 to 15 to make, level 10 to use), so top-tier gear never needs a far higher crafting level than wearing it does.

| Weapons bench (Engineering) | Level | Materials |
| --- | --- | --- |
| Scrap blade | 1 | 3 scrap metal |
| Gas cartridge ×10 | 3 | 1 scrap metal, 10 vent gas |
| Empty injector | 2 | 1 scrap metal |
| Pipe pistol | 5 | 4 scrap metal |
| Relic blade | 8 | 1 relic circuitry, 3 scrap metal |
| Relic pistol | 10 | 2 relic circuitry, 3 scrap metal |
| Alloy blade | 12 | 2 alloy plating, 2 scrap metal |
| Alloy pistol | 13 | 2 alloy plating, 2 relic circuitry, 2 scrap metal |
| Servo blade | 15 | 1 servo actuator, 2 alloy plating |
| Servo pistol | 15 | 1 servo actuator, 1 alloy plating, 2 relic circuitry |

Engineering XP comes from materials, the same per unit whatever you make: scrap metal 7, vent gas 1, relic circuitry 15, alloy plating 25, servo actuator 40. A recipe's XP is the sum over its inputs, rounded (a scrap blade is 3 scrap, so 21 XP). Set per item as `craft_xp`. These are two thirds of the old Weaponsmith and Armory rates: one skill now earns from both stations, and this keeps the effort to unlock everything about where it was.

The metal press (left of the weapons bench) presses canisters (Engineering 1, 2 scrap metal) and armor for four slots (head, torso, legs, arms) in three tiers. Scrap armor (levels 1 to 6, worn at Endurance 1) uses 2 to 5 scrap metal per piece, +22 defence for the set; relic armor (levels 5 to 8, worn at Endurance 5) uses relic circuitry and scrap, +36; alloy armor (levels 10 to 15, worn at Endurance 10) uses 2 to 5 alloy plating, +52. The breacher plate (Engineering 16, Endurance 15) is a torso piece from a servo actuator and 4 alloy plating, +28.

Healing: **healing injectors** heal 3 HP. Click one in your inventory to inject it. Like eating in OSRS, it pushes your next attack back 3 ticks (on top of your weapon's own cooldown), you can't inject another for 3 ticks, and it leaves the **empty injector** behind to refill. You can inject at full HP; it just heals nothing. Making them takes three skills:

- **Xenobiology** (gathering): harvest **ventbloom** from the glowing patches among the gas vents (level 1, 12 XP each). About half the time you get **vent salt** instead, the healing injector's secondary. Patches get picked bare and regrow.
- **Siphoning**: siphon **ichor** from the violet ichor seeps on the flats north of camp, between the long wall and the loader yard (Siphoning 5, 6 XP per success). They sit just outside the loaders' reach, so keep an eye on the west gate. Like vent gas it goes into canisters, 50 to a canister, and seeps never run dry.
- **Splicing** (manufacturing from living things: distilling, splicing, bio-engineering): at the **bio-still** in camp, distil 1 ventbloom and 1 vent salt in 5 ichor into an empty injector to make a healing injector (Splicing 1, 23 XP). Splicing XP comes from materials like Engineering's: ventbloom 10, vent salt 8, ichor 1. Empty injectors are made at the weapons bench (Engineering 2, 1 scrap metal).

Splicing works like Herblore: each injector is a plant, a secondary and a liquid in an empty injector, and each tier of injectors uses its own liquid. The plants at Xenobiology 1 and 10 make healing injectors; the ones at 5 and 15 make **boost injectors**, which raise a combat skill for 5 minutes like an OSRS potion (shown in green in the Skills tab). Boosts count for combat rolls but never for requirements, and using another refreshes the timer.

| Bio-still (Splicing) | Level | Effect | Plant | Secondary | Liquid |
| --- | --- | --- | --- | --- | --- |
| Healing injector | 1 | heals 3 | ventbloom (Xeno 1) | vent salt (from ventbloom patches) | 5 ichor (Siphoning 5) |
| Edge injector | 5 | Melee +2 and 10% | seep moss (Xeno 5) | servo grease (from wrecked haulers, Salvaging 5) | 5 ichor |
| Surge injector | 10 | heals 7 | rustcap (Xeno 10) | relic circuitry (sentry husks) | 10 coolant (Siphoning 10) |
| Deadeye injector | 15 | Firearms +3 and 10% | glowroot (Xeno 15) | alloy plating (loader husks, hulls) | 10 coolant |

Combat: relic sentries patrol the ruins east of the wall, and **loader mechs** guard the hulls in the loader yard. Click one to attack: you chase it, then swing every few ticks (your weapon's attack speed), rolling accuracy against its defence. Each attack is committed a tick before it strikes: the damage is rolled, ammo is spent and the XP drop appears then, and the hitsplat follows on the next tick. A committed attack always lands, even if you walk off or the target steps away; only its animation is cut short. It can't deal more than the target will have left once the hits already on their way land, so a swing at a target that's about to die is a 0 and gives no XP. Hitsplats show damage (red) or a miss (blue 0), and HP bars appear over anyone in combat. Sentries fight back, give up if you drag them too far from home, and respawn a while after their husk is gone.

- **Weapons:** click a weapon in your inventory to wield it. Attack speed is set by weapon type: blades (Melee) swing every 4 ticks and must stand beside the target; pistols (Firearms) fire every 3 ticks at up to 6 tiles and use one gas cartridge per shot. Blades are the steady, low-attention option; pistols are meant for kiting (shoot, step back, shoot), since running outpaces walking enemies. Fists work, badly.
- **Armor:** click armor in your inventory to wear it. It adds to your defence roll, so enemies hit you less often.
- **Level requirements:** gear needs the level of its tier. Weapons check their combat skill, armor checks Endurance. Scrap gear needs level 1, relic gear 5, alloy 10, and the servo weapons and breacher plate 15. Inspect, hover text and the skill guides show the requirement.
- **Loot comes from husks:** NPCs don't drop items. Salvage what they leave behind. Each success gives the husk's special item: relic circuitry from a sentry husk, alloy plating from a loader husk. A husk lasts 1 to 3 salvages (half the time 1, a quarter each 2 or 3), so you get 1.75 per kill on average. A destroyed NPC doesn't start its respawn countdown until its husk is gone (salvaged or crumbled), so clearing an area buys you time to salvage it: leave a husk alone and its NPC stays down until the husk crumbles. Every NPC with a husk works this way. If an NPC dies on a tile that already holds a husk, its own husk lies on the nearest free tile within 2; with none free, it leaves no husk and respawns on its plain timer.
- **Breacher mechs** guard the Pit: aggressive within 3 tiles, 34 HP, hitting up to 5. At level 15 in full alloy you win about half the time toe to toe, and nearly always with a few injectors. Their husks give servo actuators (Salvaging 15), which make the servo blade, servo pistol and breacher plate.
- **Loader mechs** are aggressive: they attack anyone within 4 tiles, and roam up to 7 tiles from their spawn, so the ones by the west gate sometimes wander out of the yard. They chase up to 11 tiles from home (roam plus aggro range), so one at the edge of its roam can still give chase. They have 24 HP and hit up to 4. A fresh character can't beat one toe to toe, and level 10 with a relic blade and scrap armor wins about 1 in 4. Level 12 with an alloy blade and alloy armor wins nearly 9 in 10. Pistols let you kite them. Their husks give alloy plating at Salvaging 10, which feeds alloy armor and blades, and last two minutes (sentry husks last one), so you can clear the yard and then salvage it.
- **No safespots:** an enemy that can't reach you walks home and heals to full, so shooting one from behind a fence it can't get around gains nothing.
- **Skills:** damage trains Melee or Firearms (by weapon), or Endurance if you switch the combat XP picker in the Gear tab, plus Toughness. Toughness is your max HP (you start at 10); Endurance makes you harder to hit.
- **Dropping and taking:** dropped items land on your tile, and anyone can take them. Click an item on the ground to walk over and pick it up. Hover a pile to see the top item; right-click it to take any item in it. Items nobody takes vanish after 3 minutes (300 ticks), like OSRS. A dropped canister keeps its gas.
- **Dying:** everything you carry and wear (inventory, weapon, armor) drops into **your wreck** where you fell, and you're printed fresh at the **manufactory** in camp with full HP. Only you can salvage your wreck: click it to walk over and take everything that fits in one go. It crumbles after 15 minutes (the label over it counts down), contents and all. Dying again before you get there leaves a second wreck with its own timer. Implants will be the one thing that survives, once the Implants skill exists. HP regenerates slowly out of combat.
- **Storage:** the **storage locker** in camp holds your own items, with no slot limit, and everything stacks in it, even blades and armor. Gas is stored apart from its canisters. Click an item to move one across, right-click for 5 or All, or use **Deposit all**. Storing a spare set of gear is how you recover from a death.
- **The loop:** a destroyed sentry leaves a sentry husk where it fell. Salvage it (any level) for 1 to 3 relic circuitry before it crumbles (about a minute). Relic circuitry makes the Relic blade (Engineering 8), so killing sentries feeds better weapons for killing sentries: Combat → Gathering → Manufacturing → Combat.

Terrain: walls and rocks block both walking and shooting. The chain fence west of the sentries blocks walking but not shooting, so with a pistol you can fire over it while they walk around. Big mech hulls block shots too; drones, vents and the weapons bench don't.

**Combat levels:** every player and hostile shows a combat level, OSRS-style, in the hover text, the right-click menu ("Attack Relic sentry (level-6)"), Inspect, and over other players' heads. It's coloured against yours: green is weaker, yellow even, red stronger. The formula is OSRS's without Prayer: `floor(0.25 × (Toughness + Endurance) + 0.65 × best of Melee and Firearms)`, so a new pilot is 3 and a maxed one 113. NPCs put their hitpoints, defence level and attack level in the same slots; `combat_level` on an NPC in `data/npcs.json` overrides that. The two weights are in `data/rules.json` (`combat.level_defence_weight`, `level_attack_weight`). Your own is in the Gear and Skills tabs.

**Minimap** (top right): the area around you, turning with the camera, with yellow dots for NPCs, white for players, red for items on the ground and blue for stations. Click it to walk there, scroll on it to zoom, and click the compass to face north. The area's name is under it.

The bottom-right panel has its tabs along its bottom edge:

- **Inventory:** HP and 28 slots. Click a weapon or armor to equip it, or an injector to inject it; drag an item onto another slot to move or swap it; shift-click to drop; right-click for options. Canisters show how full they are. Moves, drops and equips show the moment you click and are confirmed on the next tick. You can chain them as fast as you like, even under simulated lag, without the display jumping. The slot under a dragged item lights up.
- **Gear:** your weapon, your four armor slots (click to take off), where combat XP goes, and your attack and defence numbers.
- **Skills:** every planned skill, with the prototype's skills lit; hover for XP. Click a skill for its **guide**: everything it unlocks, level by level, built from the game data. Unlocks above your level are dimmed.

The chatbox (bottom left) keeps the last 500 messages; scroll it with the mouse wheel. It stays put while you're scrolled up and follows new messages when you're at the bottom.

Saving online: the server keeps the world in `saves/world.json`, autosaving every 100 ticks (one minute) and on shutdown (Ctrl+C), with the previous save kept as `world.json.bak`. Restarting the server carries on from it; `npm start -- --new` starts a fresh world instead (the old save becomes the .bak). See [Multiplayer](#multiplayer).

Saving offline: the game autosaves every 100 ticks (one minute) and when you close or reload the tab, and loads your save automatically on startup. **Ctrl+S** saves, **Ctrl+L** loads (or use the debug window's buttons, since some browsers keep Ctrl+L for the address bar). The save is the same readable JSON as before, kept in the browser's local storage under `mechscape_save`, so it belongs to that browser and that address (`localhost:8000`). In-progress actions aren't saved, so you come back standing still, like logging out in OSRS. The save before it is kept as `mechscape_save.bak`. If the save can't be read (from a newer build, say), the backup is loaded instead, and the unreadable save is moved aside as `mechscape_save.unreadable-<date>` rather than overwritten. The message log says which happened. Loading and New game reload the page.

The debug window (top left, **F4** or click its header to collapse) has:

- **Path** (**F1**): the remaining route.
- **True tile** (**F2**): an outline on the tile the simulation has the player on.
- **Tick metronome** (**F3**): a click on every tick.
- **Hitboxes** (**F5**): wireframes of what's clickable.
- **Ids in menus** (**F6**): right-click menus and hover text name each thing's id (`foreman #12`, `crashed_drone #40`, scenery with its tile).
- **Tick speed** (**[** and **]**, offline only): 0.25x to 8x. It scales the game's clock, so the simulation and everything animated speed up together; the camera and simulated latency stay at real time.
- **Simulated input delay**: base and fuzz in milliseconds. Each action is turned into JSON and held for base ± fuzz before it's sent, in order, like a reliable network channel. Online this is on top of the real network.
- **Grant XP**: pick a skill and an amount; it arrives on the next tick as a normal XP drop (and level-up), e.g. 1,154 XP for Salvaging 10. Online it only shows when the server runs with `npm run dev`; otherwise the server refuses it.
- **Save / Load / New game** (offline only), and when it last saved. New game deletes the save.

The browser console has `window.mechscape` for poking at the running game.

To check the simulation without a browser:

```
npm test              # node --test tests/*.test.js
npm run check-loops   # node tools/check_loops.js
npm run check-reach   # node tools/check_reach.js
npm run check-text    # node tools/check_text.js
```

`npm test` starts a real server on a spare port for one of its tests, so run `npm install` first. The tests cover the tick, pathing, gathering, crafting, combat (commit and land, overkill, ammo, line of sight), injectors and boosts, gear, dropping and taking, storage, death and wrecks, the action JSON round trip, and a save that carries on exactly as the original world would have over 300 ticks. For multiplayer they cover malformed actions being turned away, a browser mirror fed snapshots ending up identical to the server's world, what's kept private, joining, leaving and coming back, the server save across a restart, and two Colyseus clients on a real server. `check_loops` is the economy rule: with combat skills removed, the production graph must have no cycles, so every loop goes through combat.

## Editing content

`npm run editor` opens the content editor at <http://localhost:8090>: a page for editing everything in `data/` without touching JSON or code. It runs on your computer only and saves straight into `data/`, so restart the game server to play with the changes, and commit them with git like any other edit.

- **Maps**: paint the things layer (terrain, nodes, stations, NPCs, decor, the spawn), heights and ground with a brush, rectangle or flood fill; drag out zones; add legend entries; resize. Right-click picks up what's under the cursor, and the bar shows each tile's world coordinates and links.
- **Quests** as stages (journal, goal, next), **dialogue** as a conversation (when it's said, the lines, and a menu of choices; each choice can have its own condition, effects, response lines and a sub-menu, or go back to a menu; flags can be world, quest, player or dialogue flags), and **messages** (`data/text.json`).
- **Items, NPCs, gather nodes, recipes, stations, loot tables, mechs, skills, weapon types, terrain, decor, ground**, and the **game rules** (`data/rules.json`): every field the game reads, with its default and the note from `src/sim/defs.js`. Ids that name other content are checked as you type.
- **Rename id** updates everything that uses it (other data, map legends, text tokens). Every page lists what uses the entry.
- **Save** (Ctrl+S) writes only what changed, keeping the rest of each file byte for byte, then runs every check (content loads, maps parse, messages and tokens resolve, economy loops, reachability) and lists any problems.

What's content and what's code: names, descriptions, numbers, level requirements, recipes, loot, dialogue and the messages that name people and places are all data. Text can name content with tokens, `{npcs:foreman}`, `{area:deadfields}`, `{stations:manufactory|lower}`, `{rules:hab.rested_comfort}`, so renaming something renames it everywhere. What things *do* (a station's kind, a goal type, an effect like `craft_speed`) is code.

## How it's organised

| Folder | What lives there | Rule |
| --- | --- | --- |
| `src/sim/` | Game state and rules: `World`, `EntityState`, actions, tasks, combat, `SaveGame`, snapshots, the `GameLoop` tick driver | Plain ES modules. No DOM, no three.js, no timers: runs unchanged in Node (the server, the tests) and in the browser. |
| `server/` | The game server: `Game` (the world, who's online, logged-out pilots, autosave), the Colyseus room, the save file, static files | Node only. The only place that runs ticks when playing online. |
| `src/client/` | `ClientState` (the one place views read the game from), the links that send actions (`SimulatedLink` offline, `NetLink` online), `NetLoop` (the online mirror), the player controller, offline saving | Only talks to the sim by sending actions through the link. |
| `src/view/` | three.js: the map, models, animation, camera, hitboxes, debug overlay | Reads sim state through `ClientState`, never writes it. |
| `src/ui/` | DOM overlays: panels, menus, hover text, hitsplats, XP drops, the message log | Same rule as the views. |
| `data/` | Items, gather nodes, recipes, stations, NPCs, terrain, weapon types, skills, quests and dialogue as JSON keyed by id; `rules.json` (tuning numbers) and `text.json` (messages); maps as `.map` text | Content, not code. Edit with `npm run editor`. |
| `assets/models/` | The `.glb` models, copied from the Godot project | Set as a def's `model`. |
| `tools/` | `editor/` (the content editor), `serve.js` (static server for offline play), the checks (`check_loops.js`, `check_reach.js`, `check_text.js`), `vendor_sdk.js` and `convert_godot_data.py` | |
| `tests/` | Node tests of the sim (on their own small map) and of the server | |
| `vendor/` | three.js 0.170.0 and the Colyseus browser client 0.18 (both MIT) | |

The JSON in `data/` was generated from the Godot `.tres` files by `tools/convert_godot_data.py` (`python3 tools/convert_godot_data.py <godot project> .`). Field names are the Godot ones, references are ids, colours are `[r, g, b, a]` in sRGB, and models are file names in `assets/models/`. Now that this is its own project, edit it with the content editor (or the JSON directly).

### Models and animation

Everything drawn uses the Godot project's models unchanged: three.js loads the same `.glb` files with `GLTFLoader`, and each NPC, node and station gets its own copy (`SkeletonUtils.clone`). Hitboxes, HP-bar heights and husk handoffs work as before.

`src/view/model_animator.js` is a line-for-line port of `model_animator.gd`, and plays the same clips from the same sim events (idles picked at random, Walk and Run matched to ground speed, attacks timed so the strike frame lands as the hitsplat appears, Death, the player's activity loops, Inject and Print). Underneath it, `src/view/clip_player.js` stands in for Godot's AnimationPlayer: three.js's `AnimationMixer` holds the clips, but their times and weights are set by hand every frame, so swings stay pinned to the tick clock. For the player it also splits every clip at the `spine` bone into an upper and a lower half, which is how a swing finishes on the upper body while the legs walk.

`src/view/player_appearance.js` tints the `PL_*` materials by armor and player colour and puts the held weapon on the `hand_R` bone, as in Godot.

Lighting matches the Godot scene: the sun at (-55°, 35°, 0°) with shadows, the same ambient and sky colours, and no tone mapping. Three.js divides diffuse light by π where Godot doesn't, so the sun is intensity π and the ambient 0.6π.

### Maps

The world is built from a map file, `data/maps/scrapyard.map`: a legend that gives each character a meaning, then an ASCII grid with one character per tile.

```
name: Scrapyard

[legend]
.  floor
@  spawn
#  terrain wall
=  terrain fence
d  node crashed_drone
W  station weapons_bench
s  npc relic_sentry

[grid]
......#.....
..@...#..s..
...W..#.....
.d.......==.
```

- **Legend kinds:** `floor`, `spawn` (exactly one), `terrain <id>`, `node <id>`, `station <id>` and `npc <id>`. Ids are keys in the matching data file (`data/terrain.json`, `data/nodes.json`, `data/stations.json`, `data/npcs.json`), the same ids saves use. An `npc` tile is that NPC's spawn point.
- **The grid:** the top row is y = 0 and the left column is x = 0. Every row must be the same width. The map's size is the grid's size.
- **Comments and errors:** lines starting with `//` are comments. A bad map (a ragged row, a character not in the legend, an id that doesn't exist, no spawn) fails to load with errors that name the file and line.

**Blocking lives on the definitions, not in the map.** Terrain, gather nodes and stations each have `blocks_movement` and `blocks_sight`, in the data files. The `World` builds its pathfinding grid and line-of-sight checks from them, so a new kind of cover is a new entry in `data/terrain.json`, not new code. Terrain types so far:

- **Wall:** blocks walking and shooting.
- **Rock:** blocks walking and shooting.
- **Chain fence:** blocks walking only.

Among the nodes, sentry husks block nothing, so one can never trap whoever stood where the sentry fell. Players and NPCs never block, as in OSRS.

Things are placed in a fixed order (terrain, then objects, then NPCs, each row by row), so a map always produces the same ids. Saves match map things by tile rather than by id, so editing the map doesn't scramble an existing save: whatever still stands where it stood keeps its saved state.

The headless tests use their own small map, `tests/maps/test_yard.map` (the original 32 × 32 layout), set through `World.defaultMap`, so the game map can change without moving the tests' coordinates. A map test checks that everything on the game map can be reached from spawn. A save from a different map moves you to the new spawn, keeping everything else.

### The tick

`GameLoop` accumulates frame time and runs a fixed 0.6s tick. Each tick, `World.runTick()` runs in a fixed order: apply queued actions (in the order the client sent them) → NPC brains (respawns, aggression, wandering) → movement → tasks (hits committed last tick land first, then gathering, crafting and new attacks; damage and deaths resolve here) → regeneration → husk, wreck and ground-item cleanup. Views interpolate between the last two tick states using `ClientState.tickAlpha`, so rendering runs at any frame rate. The random number generator is seeded and saved, so a loaded world carries on exactly as the original would have.

Input is queued: clicking sends an action as JSON, and the latest action per slot wins until the next tick consumes it. Offline, `SimulatedLink` hands it to the `GameLoop` in the page. Online, `NetLink` sends it to the server, which queues it for the sender's own pilot.

## What's in the alpha

The alpha plan (`plans/alpha-plan.md` in the project) is built. Each piece of it is a feature module in `src/sim/` that hooks into the world through `features.js`, so the core rules didn't have to know about any of them. `ALPHA_NOTES.md` lists where the build took a shortcut or differs from the plan.

- **Chat and trade:** Enter to chat (text floats over you); right-click a player to trade, accepted twice.
- **The world:** four areas in one world (`data/maps/world.json`): the Commons and camp, the Undercroft dungeon under the hatch, the Deadfields (mechs only past the drop point) and the Quiet Reach up the lift. Maps have heights, ramps, ground types, decor and zones.
- **Quests** (`quests.js`): Ignition (the main story: the blueprint in the Undercroft, then the mech), Found Art (the silly side quest that ends with the paintball cannon and the easy Splatterpress) and the Quiet Reach survey. Talk to anyone with a Talk-to option.
- **Your look** (`appearance.js`): picked on the connect screen with a turntable, changed at the manufactory after a respawn. Cosmetics, pets and fun weapons (the paintball cannon, the confetti blade) are drops and rewards.
- **The mech** (`mech.js`): components from every skill chain, installed at the gantry console in camp; the walker stands up on the pad when the last one goes in. Board it as pilot or gunner, deploy it to the Deadfields, salvage wreckage only a mech can reach, and fight the scrap colossus, which only a mech can hurt. It burns vent gas and cartridges and is repaired with alloy plating, at the gantry or the rig in the Deadfields.
- **The Splatterpress** (`boss.js`): the pilot boss in the Undercroft's press hall. Dodge red tiles, soak blue ones together, run the amber panels to drop its shield, and kill the drones before they repair it. Overclocked (three phases) unlocks after Found Art.
- **The hab** (`hab.js`): the crew's quarters beside camp. Furniture and fittings from the fabricator, placed in build mode (click a piece in your inventory; Q turns, C recolours). Tool walls and coolant racks help crafters, grow beds turn Reach seeds into Splicing plants, comfort leaves you rested (+10% XP), trophies on the wall give everyone XP, and the commission board is the session's market.
- **The survey** (`survey.js`): the Quiet Reach has no enemies. Mend the bridge with scrap, feed the blast door vent gas, scan the projector, scan five landmarks and sample three specimens.

The XP rate (`npm start -- --xp-rate 1.5`) is the knob for fitting the mech into one evening.

## Multiplayer

The server is authoritative and built on [Colyseus](https://colyseus.io) 0.18. It runs the same `src/sim/` as the browser: one `World`, ticking every 0.6 s, in one Colyseus room called `scrapyard` that up to 16 players share. One Node process serves both the game's files and the room, on one port (2567 by default; `npm start -- --port 8080` to change it).

- **Each tick** the server sends every player a snapshot of the world as they may see it (`src/sim/snapshot.js`): every player and NPC, the gather nodes, items on the ground, their own wrecks, and the tick's events. Other players' inventories, storage, wrecks and messages aren't sent. Snapshots are whole, not differences: for a few friends on one map that's simple and small, around 7 KB a tick as JSON and less as Colyseus's msgpack.
- **The browser keeps a mirror**: a `World` built from the same map that never runs a tick, only applies each snapshot in place, keeping every object's id. `NetLoop` stands in for `GameLoop`, so the views and UI don't know the difference. Between snapshots, views interpolate on the time since the last one arrived.
- **Actions** go up as JSON. The server checks every field's type before building an action (`Action.FIELDS`), applies it to the sender's own pilot whatever id the client claims, refuses debug actions unless it runs with `--debug`, and skips an action that throws instead of stopping the world.
- **Joining** takes a pilot name (up to 12 letters, numbers, spaces, `-` or `_`). The page remembers it, or takes `?name=` in the URL. Names are unique among players online.
- **Leaving and coming back**: if the connection drops, the client reconnects by itself and the pilot waits in the world for 30 seconds. Reloading the page takes the waiting pilot straight back. After that the pilot logs out of the world, and the server remembers it by name (inventory, gear, XP, storage, where it stood) until that name joins again. Wrecks follow their owner back.
- **Restarts**: the autosave (`saves/world.json`, every minute and on Ctrl+C) has the world and every pilot. After a restart everyone is logged out and gets their pilot back by joining with the same name. Nothing carries over between play sessions unless you keep the save; start each session with `npm start -- --new`.

Hosting for friends: run `npm start` on the host and give friends `http://<address>:2567`. On one network that's the host's LAN address (`ipconfig` on Windows). Over the internet, the easiest is a Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:2567` prints a public https address), with no port forwarding; forwarding TCP port 2567 or Tailscale also work. There are no accounts or passwords, so anyone who can reach the port can join under any free name; only share the address with friends.

On Windows, `start-server.cmd -HostOnline` does all of that in one go: it pulls the latest code if the folder is a git checkout with a remote, runs `npm install`, opens a Cloudflare quick tunnel and prints its URL (and copies it to the clipboard), then runs the server in that window. Without `-HostOnline` (or `--host-online`), as on a double-click, it skips the tunnel and hosts for this PC and the LAN only. Server options like `--new`, `--xp-rate 1.5` or `--port` pass straight through. It looks for `cloudflared` on the PATH, then in a `cloudflared` folder next to this one; `-Cloudflared <path>` points it elsewhere, and `-SkipPull` and `-SkipInstall` skip steps. Ctrl+C saves the world and closes the tunnel. The PowerShell script itself is `start-server.ps1`.

## Differences from the Godot version

- **Saves** live in the browser's local storage, not in a file. The save format is new (version 1 of the three.js format) and doesn't read Godot saves.
- **No PvP in the sim:** an attack on another player is refused by the sim itself. In Godot it was only prevented by players having no hitbox, which a multiplayer client couldn't be trusted with. A PvP arena can switch it back on later.
- **Fixed: no lying dead at the manufactory.** A player dies and is printed in the same tick; Godot's animator stopped at the death event and never played Print, so the player lay in the death pose until it ended. Here the print wins.
- **Labels and the HUD are HTML** over the canvas instead of Godot controls and `Label3D`, with the same layout and colours.
- **No catalog export:** the debug window's Export catalog button isn't ported (`CATALOG.md`, copied from the Godot project, still describes the same content).
- **Multiplayer:** the Godot MVP was single player; this one is played on a Colyseus server, with offline single player kept behind `?offline`. Each player picks their own look, and other players' names float over them.
- **The page installs nothing:** no engine and no build. three.js and the Colyseus client are vendored; only the server needs `npm install`.

## Roadmap

- [x] Rebuild the Godot MVP in three.js: sim, map, models, animation, UI, debug tools, saving
- [ ] MVP check: a fresh character, one evening, start to alloy tier
- [x] Multiplayer: an authoritative Colyseus server running `src/sim/`, browser clients mirroring it
- [x] Alpha features: chat, trade, areas, quests, looks, the mech, the pilot boss, the hab and the survey
- [ ] Alpha: friends on one hosted server for a session
