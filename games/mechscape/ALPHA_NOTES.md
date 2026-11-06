# Alpha build notes

Where the three.js build of the alpha (October 2026) took a shortcut or differs from `plans/alpha-plan.md` and `plans/detail/`. These are deliberate choices to get a playable session; each could be revisited after the first night.

## Art

- **Everything new is procedural geometry**, not Blender models: the walker mech, the hab furniture, the puzzle machines, the landmarks, the boss's shield and the tile warnings. They're built in `src/view/mech_view.js`, `station_shapes.js` and `piece_view.js`, so swapping in a `.glb` later is a def's `model` field, as for stations.
- **The enemy models are two `.glb` files with variants.** `"variant"` on an NPC def (see `src/view/npc_variants.js`) repaints the hull and glow and bolts procedural parts onto the bones: the loader's horn and forks, the warden's pauldrons, the press's paint tank, the colossus's spikes, the foundry drone's chimney. Real models for each can replace them later.
- **Head and chassis parts are shells on the bones**, because `player.glb` is one skinned mesh with no separate parts. The plan asked for each part as its own mesh in the model.

## The mech

- **There's one mech (the walker)**, with one shared build per world. The data allows more defs in `data/mechs.json`.
- **The Scrap Colossus is the mech-only boss.** It ignores damage from anything but a mech, and it prefers to hit mechs.
- **Destroyed mechs keep their frame, legs and cockpit** (`keep_on_destroy`), so a rebuild only needs the core, weapon mount and plates. The plan didn't say how much survives.

## The pilot boss

- **The arena is a sealed room, not an instance.** One group fights at a time, and the door stays shut to newcomers until the fight ends. Anyone inside can bail out through the crew hatch; once nobody's left inside, the press resets.
- **Panel runs use one shared path per phase** rather than a path for each player.

## The hab

- **Pieces are one tile each.** There's no multi-tile furniture.
- **The hab's crafting stations are fixed on the map**, not pieces. The plan let a piece's def name a station.
- **The actions are `place_piece`, `edit_piece` (move, turn, colour, pick up) and `commission`**, instead of the plan's four decor actions.
- **Moving a piece is "pick up and place" in build mode.** It keeps its owner, and only the owner can change it.
- **Rested comes from comfort:** 12 or more comfort and a minute in the hab gives +10% XP for ten minutes. Sets add 5 comfort, and trophies add +2% XP each in their skill.
- **The commission board holds the poster's offer in escrow.** Filling a commission pays the filler at once, and the poster collects later. Each player can post 3.

## The survey

- **Puzzles are shared.** Once someone mends the bridge, feeds the blast door or switches off the veil, it stays open for everyone, and the save remembers it. A late joiner finds the paths already open, which suits a co-op evening.
- **The specimens sit behind the puzzles,** one kind behind each: skyfern past the bridge, glowcap in the cavern, ruin orchid on the overlook. Sampling has a 60% chance of a seed for the hab's grow beds. Each click gives one specimen, and only one of each kind goes in your pack: sample one you already carry and you just rummage for seeds (and a bit of XP).
- **The survey log is a line in the quest journal**, not its own window.

## After the first look (Cooper's feedback)

- **Every mech component needs level 15**, and refined sub-parts: refined metal (10 scrap at the metal press, Engineering 12), control boards (3 relic circuitry and a refined metal at the weapons bench, 13) and servo assemblies (a servo actuator and 2 refined metal at the metal press, 14). The hab workbench can make all three. A full walker takes about 34 refined metal, so roughly 340 scrap.
- **The new areas sit far off in the void** (Undercroft at 0,220, Deadfields at 260,0, Quiet Reach at 260,220), past the fog, so none can be seen from the Scrapyard. A save with a player or the mech in an area's old place puts them back at spawn or on the pad.
- **Scenery is clickable; trees and rocks are solid.** Most decor props and the rocks have a hitbox with a right-click Inspect. Dead trees and stones (`"blocks_movement": true` in `data/decor.json`) block walking but not shots; the rest can be walked through. `npm run check-reach` (also run by the tests) checks that every station, node and NPC can still be reached from spawn once the puzzles are solved. Flat things (grass, flowers, cables, creepers) have no hitbox (`"inspect": false`). Puddles, coolant pools and slag do, so they can be examined.
- **People are dressed as pilots.** The foreman, the scrap artist and the surveyor have a `look` and `cosmetics` in `data/npcs.json`, drawn with the player model's parts.
- **The survey lift runs out on a cable**, level from the tower and off the edge of the map, fading out (`"cable"` on the lift stations).

## Content editor

- **`npm run editor` edits the data** (see README, Editing content). It saves into `data/`, so changes reach the game on its next start; nothing hot-reloads.
- **Hardcoded content moved into data.** Tuning numbers (wreck time, regen, trade range, hab comfort and resting, puzzle XP, rig range, paint) are in `data/rules.json`; skill names, guide text and starting levels in `data/skills.json`; messages that name people and places in `data/text.json`; the Splatterpress's lines in its script in `data/npcs.json`. Hab sets now come from each piece's `"set"`; the specimen case lost its `"set": "greenhouse"`, which the old code ignored, so the greenhouse still needs the same three pieces.
- **Area names** are in `data/maps/world.json` ("Deadfields", not "The Deadfields") so messages can say "in the {area:deadfields}".

## Second round of feedback

- **Dialogue is a tree.** A choice can have its own "if", effects, response lines, and its own choices (a sub-menu, any depth); without a sub-menu its "after" says what's next: close, this menu again, the menu above, or the first menu. The old `say` effect still works, but the data now uses response lines. "Who built the Scrapyard?" goes back to the foreman's menu, as an example.
- **Flags have scopes:** world (shared and public, what the mech uses; the default, so old data is unchanged), quest (per player, filed under a quest), player (per player), dialogue (cleared when the conversation closes). Quest and player flags are saved with the player. A quest's flag goal takes a scope too (quest flags default to that quest). There's no general variable system: flags are true or unset.
- **The menu changed shape:** actions, Walk here, Inspect, Examine, Cancel. Inspect only appears where there are stats (hostiles, nodes, wrecks, items); people, scenery and stations only have Examine. Examine is an action (`examine`), so the server answers with a chat line on the next tick and nothing stops.
- **Hatches and lifts take one tick to step through** (a `transition` event, then the move), so the screen fades out before you arrive and fades back after. Other jumps between areas cut to black and fade in.
- **The pilot moonwalked:** `player.glb`'s Walk and Run step towards -Z while the model faces +Z. The loader now checks each Walk and Run clip and plays any that step backwards in reverse (`src/view/models.js`), so a fixed re-export won't be flipped back. The fix belongs in the Blender file too.
- **Sinking into raised ground while working** (salvaging drones on the height-1 plateau) was the work bob setting the height instead of adding to it.

## Third round of feedback

- **Combat levels** for players and hostiles (see README). People, pets and the walker have none, since nobody can fight them. The Scrap colossus comes out at 125 from its 400 HP, which suits "only a mech can touch it".
- **A minimap in the top-right**, and the side panel moved to the bottom-right with its tabs along the bottom, so they stay put when the pages change height. The minimap draws only your own area (the snapshot only sends that area's things anyway); there are no map icons yet beyond station dots.

## Scenery

- **The land round the maps is drawn, not walked.** Hills, cliffs, trees, rocks, skulls, scrap and titan wrecks out to the fog, from `data/scenery.json`, so the areas no longer float in the sky. None of it is in the sim, so it costs the server nothing and can't wall anything off. New props: boulders, rock spires, scrub trees, pines, and a titan's skull, ribs and arm.
- **A tall fence runs round the Scrapyard,** just outside its edge, with a gap for the elevator.
- **The Quiet Reach moved to a hilltop just south of the Commons** (at 0,54, ten levels up), so each can see the other. The survey lift is now an elevator: its cage is at the Commons' south fence (it moved from 4,38 to 4,47, with the surveyor), a lattice tower climbs the cliff behind it, and a walkway runs over to the Reach's north rim, where it arrives (4,0 there, was 3,22). A save with a player in the Reach's old place puts them back at spawn; opened puzzles are kept.
- **You can see the Reach's ground and scenery from the Commons and the other way, but not the people:** each client is only sent its own area's players and NPCs.
- **The sky is a gradient dome with far ridges in the haze,** and the fog is closer (45 to 125 m) so the land fades out before it ends. Underground stays dark, with no sky.
- **A boss test measured damage from full HP;** with the map changed, another mark could hit someone first, so it now measures from just before the soak lands.

## Known rough edges

- **The browser asks for `/favicon.ico` and gets a 404.** It's harmless.
- **The pieces' colour palettes live in `data/items.json`.** The board's "want" box takes any item name, quest items excepted.
