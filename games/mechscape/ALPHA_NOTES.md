# Alpha build notes

Where the three.js build of the alpha (October 2026) took a shortcut or differs from `plans/alpha-plan.md` and `plans/detail/`. These are deliberate choices to get a playable session; each could be revisited after the first night.

## Art

- **Everything new is procedural geometry**, not Blender models: the walker mech, the hab furniture, the puzzle machines, the landmarks, the boss's shield and the tile warnings. They're built in `src/view/mech_view.js`, `station_shapes.js` and `piece_view.js`, so swapping in a `.glb` later is a def's `model` field, as for stations.
- **Head and chassis parts are shells on the bones**, because `player.glb` is one skinned mesh with no separate parts. The plan asked for each part as its own mesh in the model.

## The mech

- **There's one mech (the walker)**, with one shared build per world. The data allows more defs in `data/mechs.json`.
- **The Scrap Colossus is the mech-only boss.** It ignores damage from anything but a mech, and it prefers to hit mechs.
- **Destroyed mechs keep their frame, legs and cockpit** (`keep_on_destroy`), so a rebuild only needs the core, weapon mount and plates. The plan didn't say how much survives.

## The pilot boss

- **The arena is a sealed room, not an instance.** One group fights at a time, and the door stays shut until the fight ends.
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
- **The specimens sit behind the puzzles,** one kind behind each: skyfern past the bridge, glowcap in the cavern, ruin orchid on the overlook. Sampling has a 60% chance of a seed for the hab's grow beds.
- **The survey log is a line in the quest journal**, not its own window.

## Known rough edges

- **The browser asks for `/favicon.ico` and gets a 404.** It's harmless.
- **The pieces' colour palettes live in `data/items.json`.** The board's "want" box takes any item name, quest items excepted.
