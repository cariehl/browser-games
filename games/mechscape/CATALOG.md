# MechScape catalog

Generated from the game data on 2026-10-14. Regenerate with `godot --headless -s res://tools/export_catalog.gd` or the debug window's *Export catalog* button.

41 items · 14 gather nodes · 3 NPCs · 5 stations · 28 recipes · 3 terrain types · 9 skills

## Map: Scrapyard

`res://data/maps/scrapyard.map`, 64 × 48 tiles, players start at (10, 24). Top row is y = 0, left column x = 0.

```
................................................................
................................................................
........................#...................=================...
........................#...................=...............=...
........................#...................=.r......h......=...
........................#......i............=..h............=...
........................#........m..........=...............=...
........................#...d...............=.............h.=...
........................#...................=.........o.....=...
........................#.......................L..L........=...
..........................................................r.=...
........................................................L...=...
....................d...#..........i........=...............=...
........................#............m......=....h..........=...
........................#....i..............=...........h...=...
........................#..m................=.o.....r.......=...
........................#...................=...............=...
....=====...=====.......#...................=======...=======...
....=...........=.......#.....####..............................
....=.o.........=.......#.......................................
....=...W...A...=.......#..........s...#..o.....................
....=...........=.......#..o....s......#........................
....=.K.......B.=.......#..............#........................
........................#..............#........................
..........@......................o..s...........................
....=.....M.....................................................
....=...........=.......#................##.....................
....=...........=.......#....#..................................
....=.........o.=.......#....#.s....o...........................
....=...........=.......#....#.........s........................
....=====...=====.......#....#..................................
........................#.......................................
............d...........#.........####........oooo...oooooooooo.
...o................o...#......o..............o..............c..
......d.................#.....................o....b...........w
..............d.........#.....................o......o....v.....
........................#.....................o..v...........b..
..........d.............#.....................o.................
..H................d............................b........b......
............o.........................................v.........
....d...............H...#.......X................o..............
................d.......#.....................o......b...o....b.
........................#.....d.......g.......o............v....
........d...............#.....g...............o....v............
..o...............o.....#.....................o.................
.........H..............#...........X.........o..b......v.......
.......o......................................o.............b...
..................................g.............c.............w.
```

## Terrain

| Terrain | Blocks | On the map |
| --- | --- | --- |
| **Chain fence** `fence` | walking only (shoot over it) | 95 tiles |
| **Rock** `rock` | walking and shooting | 43 tiles |
| **Wall** `wall` | walking and shooting | 56 tiles |

## Items

| Item | Stacks | Equipment | Comes from | Used for |
| --- | --- | --- | --- | --- |
| **Alloy blade** `alloy_blade` |  | Blade (Melee 10), every 4 ticks, range 1, +28 acc, 26 power | Engineering 12: Alloy blade recipe | Wield (Melee) |
| **Alloy chestplate** `alloy_chestplate` |  | Torso armor, +21 defence, needs Endurance 10 | Engineering 15: Alloy chestplate recipe | Wear (Torso) |
| **Alloy gauntlets** `alloy_gauntlets` |  | Arms armor, +7 defence, needs Endurance 10 | Engineering 11: Alloy gauntlets recipe | Wear (Arms) |
| **Alloy greaves** `alloy_greaves` |  | Legs armor, +14 defence, needs Endurance 10 | Engineering 13: Alloy greaves recipe | Wear (Legs) |
| **Alloy helmet** `alloy_helmet` |  | Head armor, +10 defence, needs Endurance 10 | Engineering 10: Alloy helmet recipe | Wear (Head) |
| **Alloy pistol** `alloy_pistol` |  | Pistol (Firearms 10), every 3 ticks, range 6, +38 acc, 24 power, uses gas cartridge | Engineering 13: Alloy pistol recipe | Wield (Firearms) |
| **Alloy plating** `alloy_plating` |  |  | Salvaging 15: Breacher husk (left by Breacher mech), 35% of successes<br>Salvaging 10: Derelict mech hull<br>Salvaging 10: Loader husk (left by Loader mech) | Alloy blade (×2)<br>Alloy chestplate (×5)<br>Alloy gauntlets (×2)<br>Alloy greaves (×3)<br>Alloy helmet (×2)<br>Alloy pistol (×2)<br>Breacher plate (×4)<br>Deadeye injector (×1)<br>Servo blade (×2)<br>Servo pistol (×1) |
| **Breacher plate** `breacher_plate` |  | Torso armor, +28 defence, needs Endurance 15 | Engineering 16: Breacher plate recipe | Wear (Torso) |
| **Canister** `canister` |  |  | Engineering 1: Canister recipe | Holds 50 coolant<br>Holds 50 ichor<br>Holds 50 vent gas |
| **Coolant** `coolant` | 50 per canister |  | Siphoning 10: Coolant leak | Deadeye injector (×10)<br>Surge injector (×10) |
| **Deadeye injector** `deadeye_injector` |  |  | Splicing 15: Deadeye injector recipe | — |
| **Edge injector** `edge_injector` |  |  | Splicing 5: Edge injector recipe | — |
| **Empty injector** `empty_injector` |  |  | Engineering 2: Empty injector recipe | Deadeye injector (×1)<br>Edge injector (×1)<br>Healing injector (×1)<br>Surge injector (×1) |
| **Gas cartridge** `gas_cartridge` | stacks |  | Engineering 3: Gas cartridge recipe | Ammo for Alloy pistol<br>Ammo for Pipe pistol<br>Ammo for Relic pistol<br>Ammo for Servo pistol |
| **Glowroot** `glowroot` |  |  | Xenobiology 15: Glowroot tangle | Deadeye injector (×1) |
| **Healing injector** `healing_injector` |  |  | Splicing 1: Healing injector recipe | — |
| **Ichor** `ichor` | 50 per canister |  | Siphoning 5: Ichor seep<br>Siphoning 15: Ichor wellspring | Edge injector (×5)<br>Healing injector (×5) |
| **Pipe pistol** `pipe_pistol` |  | Pistol (Firearms 1), every 3 ticks, range 6, +16 acc, 12 power, uses gas cartridge | Engineering 5: Pipe pistol recipe | Wield (Firearms) |
| **Relic blade** `relic_blade` |  | Blade (Melee 5), every 4 ticks, range 1, +20 acc, 19 power | Engineering 8: Relic blade recipe | Wield (Melee) |
| **Relic chestplate** `relic_chestplate` |  | Torso armor, +15 defence, needs Endurance 5 | Engineering 8: Relic chestplate recipe | Wear (Torso) |
| **Relic circuitry** `relic_circuitry` |  |  | Salvaging 1: Sentry husk (left by Relic sentry) | Alloy pistol (×2)<br>Relic blade (×1)<br>Relic chestplate (×3)<br>Relic gauntlets (×1)<br>Relic greaves (×2)<br>Relic helmet (×1)<br>Relic pistol (×2)<br>Servo pistol (×2)<br>Surge injector (×1) |
| **Relic gauntlets** `relic_gauntlets` |  | Arms armor, +5 defence, needs Endurance 5 | Engineering 6: Relic gauntlets recipe | Wear (Arms) |
| **Relic greaves** `relic_greaves` |  | Legs armor, +10 defence, needs Endurance 5 | Engineering 7: Relic greaves recipe | Wear (Legs) |
| **Relic helmet** `relic_helmet` |  | Head armor, +6 defence, needs Endurance 5 | Engineering 5: Relic helmet recipe | Wear (Head) |
| **Relic pistol** `relic_pistol` |  | Pistol (Firearms 5), every 3 ticks, range 6, +28 acc, 18 power, uses gas cartridge | Engineering 10: Relic pistol recipe | Wield (Firearms) |
| **Rustcap** `rustcap` |  |  | Xenobiology 10: Rustcap cluster | Surge injector (×1) |
| **Scrap blade** `scrap_blade` |  | Blade (Melee 1), every 4 ticks, range 1, +10 acc, 12 power | Engineering 1: Scrap blade recipe | Wield (Melee) |
| **Scrap chestplate** `scrap_chestplate` |  | Torso armor, +9 defence, needs Endurance 1 | Engineering 6: Scrap chestplate recipe | Wear (Torso) |
| **Scrap gauntlets** `scrap_gauntlets` |  | Arms armor, +3 defence, needs Endurance 1 | Engineering 2: Scrap gauntlets recipe | Wear (Arms) |
| **Scrap greaves** `scrap_greaves` |  | Legs armor, +6 defence, needs Endurance 1 | Engineering 4: Scrap greaves recipe | Wear (Legs) |
| **Scrap helmet** `scrap_helmet` |  | Head armor, +4 defence, needs Endurance 1 | Engineering 1: Scrap helmet recipe | Wear (Head) |
| **Scrap metal** `scrap_metal` |  |  | Salvaging 1: Crashed drone<br>Salvaging 5: Wrecked hauler | Alloy blade (×2)<br>Alloy pistol (×2)<br>Canister (×2)<br>Empty injector (×1)<br>Gas cartridge (×1)<br>Pipe pistol (×4)<br>Relic blade (×3)<br>Relic chestplate (×3)<br>Relic gauntlets (×2)<br>Relic greaves (×2)<br>Relic helmet (×2)<br>Relic pistol (×3)<br>Scrap blade (×3)<br>Scrap chestplate (×5)<br>Scrap gauntlets (×2)<br>Scrap greaves (×3)<br>Scrap helmet (×2) |
| **Seep moss** `seep_moss` |  |  | Xenobiology 5: Seep moss patch | Edge injector (×1) |
| **Servo actuator** `servo_actuator` |  |  | Salvaging 15: Breacher husk (left by Breacher mech) | Breacher plate (×1)<br>Servo blade (×1)<br>Servo pistol (×1) |
| **Servo blade** `servo_blade` |  | Blade (Melee 15), every 4 ticks, range 1, +36 acc, 32 power | Engineering 15: Servo blade recipe | Wield (Melee) |
| **Servo grease** `servo_grease` |  |  | Salvaging 5: Wrecked hauler, 12% of successes | Edge injector (×1) |
| **Servo pistol** `servo_pistol` |  | Pistol (Firearms 15), every 3 ticks, range 6, +46 acc, 29 power, uses gas cartridge | Engineering 15: Servo pistol recipe | Wield (Firearms) |
| **Surge injector** `surge_injector` |  |  | Splicing 10: Surge injector recipe | — |
| **Vent gas** `vent_gas` | 50 per canister |  | Siphoning 1: Gas vent | Gas cartridge (×10) |
| **Vent salt** `vent_salt` | stacks |  | Xenobiology 1: Ventbloom patch, 45% of successes | Healing injector (×1) |
| **Ventbloom** `ventbloom` |  |  | Xenobiology 1: Ventbloom patch | Healing injector (×1) |

## Weapon types

Attack speed, range and skill are standard per type; weapons differ in accuracy, power and ammo.

| Type | Skill | Speed | Range | Weapons |
| --- | --- | --- | --- | --- |
| **Blade** `blade` | Melee | every 4 ticks | 1 | Alloy blade, Relic blade, Scrap blade, Servo blade |
| **Pistol** `pistol` | Firearms | every 3 ticks | 6 | Alloy pistol, Pipe pistol, Relic pistol, Servo pistol |

## Gather nodes

| Node | Skill & level | XP | Gives | Attempts | Depletion | Blocks | On the map |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Breacher husk** `breacher_husk` | Salvaging 15 | 70 | servo actuator, sometimes alloy plating (35%) | every 4 ticks; 43% at lvl 15, 86% at 99 | temporary: gone when stripped (50% per success, at most 3) or after 250 ticks | nothing | left by destroyed NPCs |
| **Coolant leak** `coolant_leak` | Siphoning 10 | 10 | coolant | every 5 ticks; 40% at lvl 10, 88% at 99 | never depletes | walking only (shoot over it) | 2 at (61, 33), (48, 47) |
| **Crashed drone** `crashed_drone` | Salvaging 1 | 20 | scrap metal | every 4 ticks; 39% at lvl 1, 79% at 99 | depletes 15% per success, respawns 10 ticks | walking only (shoot over it) | 11 tiles |
| **Derelict mech hull** `derelict_hull` | Salvaging 10 | 45 | alloy plating | every 4 ticks; 14% at lvl 10, 63% at 99 | depletes 20% per success, respawns 25 ticks | walking and shooting | 5 at (53, 4), (47, 5), (58, 7), (49, 13), (56, 14) |
| **Gas vent** `gas_vent` | Siphoning 1 | 8 | vent gas | every 5 ticks; 59% at lvl 1, 94% at 99 | never depletes | walking only (shoot over it) | 6 at (58, 35), (49, 36), (54, 39), (59, 42), (51, 43), (56, 45) |
| **Glowroot tangle** `glowroot_tangle` | Xenobiology 15 | 46 | glowroot | every 4 ticks; 32% at lvl 15, 80% at 99 | depletes 30% per success, respawns 40 ticks | nothing | 3 at (38, 42), (30, 43), (34, 47) |
| **Ichor seep** `ichor_seep` | Siphoning 5 | 6 | ichor | every 5 ticks; 45% at lvl 5, 90% at 99 | never depletes | walking only (shoot over it) | 3 at (31, 5), (35, 12), (29, 14) |
| **Ichor wellspring** `ichor_wellspring` | Siphoning 15 | 12 | ichor | every 4 ticks; 47% at lvl 15, 92% at 99 | never depletes | walking only (shoot over it) | 2 at (63, 34), (62, 47) |
| **Loader husk** `loader_husk` | Salvaging 10 | 50 | alloy plating | every 4 ticks; 51% at lvl 10, 90% at 99 | temporary: gone when stripped (50% per success, at most 3) or after 200 ticks | nothing | left by destroyed NPCs |
| **Rustcap cluster** `rustcap_cluster` | Xenobiology 10 | 34 | rustcap | every 4 ticks; 36% at lvl 10, 84% at 99 | depletes 25% per success, respawns 35 ticks | nothing | 3 at (46, 4), (58, 10), (52, 15) |
| **Seep moss patch** `seep_moss_patch` | Xenobiology 5 | 22 | seep moss | every 4 ticks; 41% at lvl 5, 88% at 99 | depletes 25% per success, respawns 30 ticks | nothing | 3 at (33, 6), (37, 13), (27, 15) |
| **Sentry husk** `sentry_husk` | Salvaging 1 | 30 | relic circuitry | every 4 ticks; 55% at lvl 1, 90% at 99 | temporary: gone when stripped (50% per success, at most 3) or after 100 ticks | nothing | left by destroyed NPCs |
| **Ventbloom patch** `ventbloom_patch` | Xenobiology 1 | 12 | ventbloom, sometimes vent salt (45%) | every 4 ticks; 43% at lvl 1, 90% at 99 | depletes 25% per success, respawns 30 ticks | nothing | 8 at (51, 34), (61, 36), (48, 38), (57, 38), (53, 41), (62, 41), (49, 45), (60, 46) |
| **Wrecked hauler** `wrecked_hauler` | Salvaging 5 | 28 | scrap metal, sometimes servo grease (12%) | every 4 ticks; 38% at lvl 5, 86% at 99 | depletes 15% per success, respawns 15 ticks | walking only (shoot over it) | 3 at (2, 38), (20, 40), (9, 45) |

## NPCs

| NPC | HP | Attack | Defence | Behaviour | Leaves | Drops | On the map |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Breacher mech** `breacher_mech` | 34 | lvl 18, +16 acc, max hit 5, every 5 ticks, range 1 | lvl 18, +24 | aggressive (3 tiles); wanders 3, leash 9, respawns 60 ticks | Breacher husk | — | 2 at (32, 40), (36, 45) |
| **Loader mech** `loader_mech` | 24 | lvl 14, +10 acc, max hit 4, every 6 ticks, range 1 | lvl 10, +16 | aggressive (4 tiles); wanders 7, leash 11, respawns 50 ticks | Loader husk | — | 3 at (48, 9), (51, 9), (56, 11) |
| **Relic sentry** `relic_sentry` | 12 | lvl 4, +0 acc, max hit 1, every 6 ticks, range 1 | lvl 2, +0 | passive, retaliates; wanders 3, leash 8, respawns 25 ticks | Sentry husk | — | 5 at (35, 20), (32, 21), (36, 24), (31, 28), (39, 29) |

NPCs and players never block walking or shooting: like OSRS, anyone can share a tile.

## Stations

| Station | Skill | Recipes (menu order) | Blocks | On the map |
| --- | --- | --- | --- | --- |
| **Bio-still** `bio_still` | Splicing | Healing injector, Edge injector, Surge injector, Deadeye injector | walking only (shoot over it) | 1 at (14, 22) |
| **Manufactory** `manufactory` |  |  | walking only (shoot over it) | 1 at (10, 25) |
| **Metal press** `metal_press` | Engineering | Canister, Scrap helmet, Scrap gauntlets, Scrap greaves, Scrap chestplate, Relic helmet, Relic gauntlets, Relic greaves, Relic chestplate, Alloy helmet, Alloy gauntlets, Alloy greaves, Alloy chestplate, Breacher plate | walking only (shoot over it) | 1 at (12, 20) |
| **Storage locker** `storage_locker` |  |  | walking only (shoot over it) | 1 at (6, 22) |
| **Weapons bench** `weapons_bench` | Engineering | Scrap blade, Gas cartridge, Empty injector, Pipe pistol, Relic blade, Relic pistol, Alloy blade, Alloy pistol, Servo blade, Servo pistol | walking only (shoot over it) | 1 at (8, 20) |

## Recipes

| Recipe | Skill & level | XP | Inputs | Makes | Time | Made at |
| --- | --- | --- | --- | --- | --- | --- |
| **Alloy blade** `alloy_blade` | Engineering 12 | 64 | 2 × Alloy plating, 2 × Scrap metal | 1 × Alloy blade | 5 ticks | Weapons bench |
| **Alloy chestplate** `alloy_chestplate` | Engineering 15 | 125 | 5 × Alloy plating | 1 × Alloy chestplate | 4 ticks | Metal press |
| **Alloy gauntlets** `alloy_gauntlets` | Engineering 11 | 50 | 2 × Alloy plating | 1 × Alloy gauntlets | 4 ticks | Metal press |
| **Alloy greaves** `alloy_greaves` | Engineering 13 | 75 | 3 × Alloy plating | 1 × Alloy greaves | 4 ticks | Metal press |
| **Alloy helmet** `alloy_helmet` | Engineering 10 | 50 | 2 × Alloy plating | 1 × Alloy helmet | 4 ticks | Metal press |
| **Alloy pistol** `alloy_pistol` | Engineering 13 | 94 | 2 × Alloy plating, 2 × Relic circuitry, 2 × Scrap metal | 1 × Alloy pistol | 5 ticks | Weapons bench |
| **Breacher plate** `breacher_plate` | Engineering 16 | 140 | 1 × Servo actuator, 4 × Alloy plating | 1 × Breacher plate | 5 ticks | Metal press |
| **Canister** `canister` | Engineering 1 | 14 | 2 × Scrap metal | 1 × Canister | 3 ticks | Metal press |
| **Deadeye injector** `deadeye_injector` | Splicing 15 | 79 | 1 × Empty injector, 1 × Glowroot, 10 × Coolant, 1 × Alloy plating | 1 × Deadeye injector | 4 ticks | Bio-still |
| **Edge injector** `edge_injector` | Splicing 5 | 35 | 1 × Empty injector, 1 × Seep moss, 5 × Ichor, 1 × Servo grease | 1 × Edge injector | 4 ticks | Bio-still |
| **Empty injector** `empty_injector` | Engineering 2 | 7 | 1 × Scrap metal | 1 × Empty injector | 3 ticks | Weapons bench |
| **Gas cartridge** `gas_cartridges` | Engineering 3 | 17 | 1 × Scrap metal, 10 × Vent gas | 10 × Gas cartridge | 3 ticks | Weapons bench |
| **Healing injector** `healing_injector` | Splicing 1 | 23 | 1 × Empty injector, 1 × Ventbloom, 5 × Ichor, 1 × Vent salt | 1 × Healing injector | 4 ticks | Bio-still |
| **Pipe pistol** `pipe_pistol` | Engineering 5 | 28 | 4 × Scrap metal | 1 × Pipe pistol | 5 ticks | Weapons bench |
| **Relic blade** `relic_blade` | Engineering 8 | 36 | 1 × Relic circuitry, 3 × Scrap metal | 1 × Relic blade | 5 ticks | Weapons bench |
| **Relic chestplate** `relic_chestplate` | Engineering 8 | 66 | 3 × Relic circuitry, 3 × Scrap metal | 1 × Relic chestplate | 4 ticks | Metal press |
| **Relic gauntlets** `relic_gauntlets` | Engineering 6 | 29 | 1 × Relic circuitry, 2 × Scrap metal | 1 × Relic gauntlets | 4 ticks | Metal press |
| **Relic greaves** `relic_greaves` | Engineering 7 | 44 | 2 × Relic circuitry, 2 × Scrap metal | 1 × Relic greaves | 4 ticks | Metal press |
| **Relic helmet** `relic_helmet` | Engineering 5 | 29 | 1 × Relic circuitry, 2 × Scrap metal | 1 × Relic helmet | 4 ticks | Metal press |
| **Relic pistol** `relic_pistol` | Engineering 10 | 51 | 2 × Relic circuitry, 3 × Scrap metal | 1 × Relic pistol | 5 ticks | Weapons bench |
| **Scrap blade** `scrap_blade` | Engineering 1 | 21 | 3 × Scrap metal | 1 × Scrap blade | 4 ticks | Weapons bench |
| **Scrap chestplate** `scrap_chestplate` | Engineering 6 | 35 | 5 × Scrap metal | 1 × Scrap chestplate | 4 ticks | Metal press |
| **Scrap gauntlets** `scrap_gauntlets` | Engineering 2 | 14 | 2 × Scrap metal | 1 × Scrap gauntlets | 4 ticks | Metal press |
| **Scrap greaves** `scrap_greaves` | Engineering 4 | 21 | 3 × Scrap metal | 1 × Scrap greaves | 4 ticks | Metal press |
| **Scrap helmet** `scrap_helmet` | Engineering 1 | 14 | 2 × Scrap metal | 1 × Scrap helmet | 4 ticks | Metal press |
| **Servo blade** `servo_blade` | Engineering 15 | 90 | 1 × Servo actuator, 2 × Alloy plating | 1 × Servo blade | 5 ticks | Weapons bench |
| **Servo pistol** `servo_pistol` | Engineering 15 | 95 | 1 × Servo actuator, 1 × Alloy plating, 2 × Relic circuitry | 1 × Servo pistol | 5 ticks | Weapons bench |
| **Surge injector** `surge_injector` | Splicing 10 | 61 | 1 × Empty injector, 1 × Rustcap, 10 × Coolant, 1 × Relic circuitry | 1 × Surge injector | 4 ticks | Bio-still |

## Skills

| Skill | Slice | Start |
| --- | --- | --- |
| Melee | Combat | starts at 1 |
| Firearms | Combat | starts at 1 |
| Toughness | Combat | starts at 10 |
| Endurance | Combat | starts at 1 |
| Salvaging | Gathering | starts at 1 |
| Siphoning | Gathering | starts at 1 |
| Xenobiology | Gathering | starts at 1 |
| Engineering | Manufacturing | starts at 1 |
| Splicing | Manufacturing | starts at 1 |

## Production flow (combat removed)

- Engineering -> Siphoning (canister)
- Engineering -> Splicing (empty injector)
- Salvaging -> Engineering (alloy plating, scrap metal, relic circuitry, servo actuator)
- Salvaging -> Splicing (alloy plating, servo grease, relic circuitry)
- Siphoning -> Engineering (vent gas)
- Siphoning -> Splicing (coolant, ichor)
- Xenobiology -> Splicing (glowroot, seep moss, ventbloom, vent salt, rustcap)

Loop rule: OK, no production loop bypasses combat.
