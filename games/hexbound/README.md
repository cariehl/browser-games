# Hexbound Tactics — combat prototype

A browser-playable, three.js hex-grid tactics prototype: a party of four heroes with tabletop-style classes,
subclasses, ancestries, feats and power choices, fighting four hand-built scenarios on their own, or a three-act roguelite run with branching maps,
generated fights, events, merchants, magic gear and act bosses.

## Run it

Open `index.html` in a modern browser (Chrome, Firefox, Edge, Safari). No build step, no server needed —
everything is plain scripts, and three.js is vendored in `vendor/`.

## What's in it

- **Rules engine** (`js/engine.js`): standard / move / minor actions, at-will / encounter / daily powers,
  attack rolls vs AC / Fortitude / Reflex / Will, combat advantage (flanking, prone, dazed…), opportunity
  attacks, marks, conditions with "save ends" / "until end of next turn" durations, ongoing damage, forced
  movement (push / pull / slide, into hazards), healing surges, Second Wind, action points, dying and death
  saves, minions, elites and a solo boss that acts twice per round.
- **Classes** (`js/data/classes.js`): Fighter, Rogue, Ranger, Cleric, Warlord, Wizard, each with 2 subclasses
  and 11–12 powers to choose from; 6 ancestries; 21 feats.
  Each class has its own lane, and `tests/rules.js` checks no two classes share a power with the same mechanics:
  the **Fighter** marks and pins (Hold the Line stops shifting; Crushing Blow punishes its own marks), the **Rogue**
  lives on combat advantage (Twisting Knife sneak-attacks without it, Deadly Gambit crits on 17+ with it), the
  **Ranger** hunts its quarry and moves, the **Cleric** heals, sears and protects (defense bonuses, dazzling and
  blinding foes), the **Warlord** rallies with temporary HP, commands attacks, buffs attacks and moves allies, and the
  **Wizard** controls areas.
- **Campaign** (`js/campaign.js`, `js/campaign-ui.js`): *Start a Campaign* on the main menu opens the party
  builder as party creation, then a three-act run on Slay-the-Spire-style branching maps:
  *Act I, The Thornwood* (boss: The Lantern Barrow), *Act II, The King's Road* (boss: The Red Toll) and
  *Act III, Hollowmere* (boss: The Pastry Golem). Each act's map is seeded per run and mixes
  ⚔ fights, 💀 elites, ❓ events, 💰 merchants, 🔥 rest sites and a 🧰 treasure chest, with a rest site before the boss.
  - Wounds, spent healing surges, used daily powers, items and gear carry from node to node. After every won
    fight the party makes camp: gold, a consumable or two, XP, and a short rest (spend surges to heal).
    Beating an act boss is an extended rest: full HP, surges and dailies.
  - **Levels by XP** (fight 1, elite or boss 2): Level 2 at 3 XP, 3 at 6, 4 at 10, 5 at 14, and beating an act
    boss guarantees Level 3 (Act I) or 5 (Act II). Level ups offer the newly unlocked power and feat picks.
  - **Generated fights** (`js/data/encounters.js`): seeded battlefields for four biomes (forest, barrow, road,
    bakery streets) filled from five factions (goblins, Thornwood beasts, the restless dead, bandits, rogue
    confections) to a budget that follows the number of living heroes. Every monster is scaled to the party's
    level (+1 attack, defenses and damage and +8 HP per level for a standard monster). Elites lead with an
    elite monster and call reinforcements on round 3. Hand-built boss fights never scale up, only down for an
    underlevelled party, and thin out their rank and file if heroes have died.
  - **Gear** (`js/data/gear.js`): four slots, 4e style. Weapons/implements add to attack and damage rolls (and
    +1d6 crit per plus), armor to AC, neck items to Fortitude, Reflex and Will; trinkets give speed, surges,
    saves and the like. 25 items in three tiers, several with a trick (Emberbrand sets crits on fire,
    Gravewarden smites undead, Briarhide hurts attackers, the Phoenix Feather keeps you standing once).
    Elites offer a choice of two, bosses three; merchants sell three; chests hold one. In a run there is no
    automatic +1 at Level 3: enhancement comes from gear. Manage it all under 🎒 Gear & packs.
  - **Events** (`js/data/events.js`): 12 encounters with 2–4 choices each, settled by skill checks: d20 + the best
    living hero's bonus (ability modifier + half level, +5 if their class is trained, +2 for some ancestries) vs
    DC 10/15/19 + half level. Outcomes give or take gold, items, gear, HP, daily powers, XP, permanent boons
    (Hale, Blessed, Drilled…) and curses (Bone-Weary, Hexed, Frail), and a few turn into fights.
  - **Merchants**: gear, consumables, a field surgeon, a curse-lifting priest, and the *Rite of Return* to raise a
    fallen hero. Sell spare gear from the stash for 40%. **Rest sites**: recover (full HP, +2 surges), meditate
    (all daily powers back), forage (a consumable each), or hold a vigil to bring back the fallen.
  - A hero who dies stays dead unless raised. Runs save in the browser and can be continued from the menu;
    every finished or abandoned run goes into the **Record of Heroes**.
- **Scenarios** (`js/data/scenarios.js`, `js/data/monsters.js`):
  1. *Thornwood Crossing* — Level 1 vs goblins (bridges, a ford, reinforcements, a warboss).
  2. *The Lantern Barrow* — Level 2 vs the restless dead (headstones, soul lanterns that let Old Sallow the
     Lantern Widow raise fallen Rattlebones until you smash them, and a radiant burst when you do).
  3. *The Red Toll* — Level 3 vs bandits (exploding oil barrels, campfire, a riposting captain).
  4. *The Grand Bakery* — Level 5 vs **The Pastry Golem**: a three-phase solo boss with telegraphed
     Grand Soufflé slams, frosting sprays that glaze the floor, ovens that spawn gingerbread guards,
     cream puffs that burst when popped, jam jars, and a cinnamon roll that bowls you over.
- **Campaign monsters**: Thornback Spiders, Spiderlings and Bristleback Boars in the Thornwood, plus an elite for
  each faction (Old Gnarl the Mossback Ogre, a Goblin Warchief, the Ashen Knight, a Toll Enforcer and the Fondant
  Knight). Thornwood Crossing also shows up as an Act I elite.
- **Items** (`js/data/items.js`): each hero starts every fight with one random consumable in their pack:
  potions (minor action: a healing draught, a bark-skin tonic, a clarity draught, a speed philter),
  throwables (standard action: fire, frost and thunder bursts, a snare, blinding dust) or a field
  dressing that can revive a dying ally. Item attacks use the item's bonus + level, not an ability score.
- **Party builder** (`js/builder.js`): point-buy abilities, ancestry, class/subclass, feats per level,
  power picks per slot; parties are saved in the browser and can be exported/imported as a code.
  One build covers every scenario — level 2, 3 and 5 choices unlock automatically.
- **AI** (`js/ai.js`): scores every reachable hex × power × target by expected value; artillery keeps its
  distance, skirmishers hunt flanks, leaders heal, monsters ignore the fallen with area attacks.
- **Keyword popups** (`js/keywords.js`): tooltips for units, terrain and powers get side panels explaining
  the statuses and rules words they mention (prone, marked, combat advantage, difficult terrain…).
- **Juice**: hit-chance previews, flank hints, opportunity-attack path warnings, dice popups, crits with
  camera shake, multi-kill and overkill banners, boss barks, Momentum rerolls, synthesized sound.

## Published copy

The game is published at https://cariehl.github.io/hexbound/ (from the `cariehl.github.io` repo, which holds a copy of
`index.html`, `css/`, `js/` and `vendor/`). When it runs on a `github.io` host (or with `?site` in the URL for a local
preview over http), the main menu shows a **← Back** link to the site's front page and a **📝 Commentary** button
that renders `../commentary/hexbound.md` with the vendored `marked` (the button stays hidden while that file is missing).
Set `SOURCE_URL` at the top of `js/game.js` to also show a GitHub link.

## Tests

```
node tests/rules.js           # rules regression checks (line of sight, movement, charge, dying, Large creatures)
node tests/sim.js 20          # headless AI-vs-AI balance runs for every scenario × premade party
node tests/fuzz.js 40         # fires every hero power and item in random situations (walls, hazards, the Large golem, objects, the dying) and checks the battle stays sane
node tests/campaign.js 20      # headless AI runs through the whole three-act campaign (add --verbose for a fight log)
node tests/one.js golem 0 5   # one verbose battle log (scenario, party index, seed)
node tests/shot.js /tmp/shots # Playwright screenshots of menu, builder and each battle
node tests/auto.js /tmp/shots # full in-browser autoplay of all four battles, reports JS errors
node tests/campaign-ui.js /tmp/shots 22 # in-browser campaign walk: every node type, camp, gear, resume, record
```

## Licensing note

The mechanics follow the general shape of 4th-edition-era tabletop play (power cadence, four defenses,
surges, marking, roles), which are game mechanics rather than protected text. All names, power text,
classes' flavor, monsters and setting are original to this prototype.
