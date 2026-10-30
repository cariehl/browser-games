# Hexbound Tactics — combat prototype

A browser-playable, three.js hex-grid tactics prototype: a party of four heroes with tabletop-style classes,
subclasses, ancestries, feats and power choices, fighting three hand-built scenarios.

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
- **Scenarios** (`js/data/scenarios.js`, `js/data/monsters.js`):
  1. *Thornwood Crossing* — Level 1 vs goblins (bridges, a ford, reinforcements, a warboss).
  2. *The Red Toll* — Level 3 vs bandits (exploding oil barrels, campfire, a riposting captain).
  3. *The Grand Bakery* — Level 5 vs **The Pastry Golem**: a three-phase solo boss with telegraphed
     Grand Soufflé slams, frosting sprays that glaze the floor, ovens that spawn gingerbread guards,
     cream puffs that burst when popped, jam jars, and a cinnamon roll that bowls you over.
- **Party builder** (`js/builder.js`): point-buy abilities, ancestry, class/subclass, feats per level,
  power picks per slot; parties are saved in the browser and can be exported/imported as a code.
  One build covers all three scenarios — level 3 and 5 choices unlock automatically.
- **AI** (`js/ai.js`): scores every reachable hex × power × target by expected value; artillery keeps its
  distance, skirmishers hunt flanks, leaders heal, monsters ignore the fallen with area attacks.
- **Juice**: hit-chance previews, flank hints, opportunity-attack path warnings, dice popups, crits with
  camera shake, multi-kill and overkill banners, boss barks, Momentum rerolls, synthesized sound.

## Tests

```
node tests/sim.js 20          # headless AI-vs-AI balance runs for every scenario × premade party
node tests/one.js golem 0 5   # one verbose battle log (scenario, party index, seed)
node tests/shot.js /tmp/shots # Playwright screenshots of menu, builder and each battle
node tests/auto.js /tmp/shots # full in-browser autoplay of all three battles, reports JS errors
```

## Licensing note

The mechanics follow the general shape of 4th-edition-era tabletop play (power cadence, four defenses,
surges, marking, roles), which are game mechanics rather than protected text. All names, power text,
classes' flavor, monsters and setting are original to this prototype.
