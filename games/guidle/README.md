# GUIDle

A browser game where every roll is a random UUID. The game scans each ID for fun patterns
(runs, palindromes, counting sequences, hex words like `C0FFEE`, famous numbers like `404`)
and awards badges for them. Rarer badges score more points, multiple badges build a combo,
and beating your high score sets off a celebration.

Open `index.html` in any modern browser to play. Press **Space** or click **Roll**.
Clicking Roll again while the ID is spinning skips the animation.

## How scoring works

- 63 badges in five tiers. Each badge's tier comes from its real odds, measured by
  simulating two million rolls (`src/odds.json`).
  - Common 10 pts, Uncommon 25, Rare 75, Epic 250.
  - Legendary badges are worth at least 1,000 and scale with rarity, so `C0FFEE` pays far more than a run of five.
- Some badges are a ladder (for example Hat Trick → Four of a Kind → High Five → Broken Record);
  only the highest rung on a ladder is awarded.
- Each badge beyond the first adds ×0.2 to the combo multiplier.
- A roll with no patterns earns **Perfectly Average**.

Roll history (last 250 rolls), lifetime badge counts, and your high score are saved in
`localStorage` in your browser.

## Project layout

| Path | What it is |
| --- | --- |
| `src/badges.js` | Badge engine: pattern detectors, ladders, scoring. Runs in the browser and in Node. |
| `src/page.html` | Page markup, styles, and game UI. |
| `src/odds.json` | Measured odds per badge. |
| `scripts/simulate-odds.js` | Regenerates `src/odds.json` (`node scripts/simulate-odds.js 2000000`, takes a few minutes). |
| `scripts/build.js` | Inlines everything into the standalone `index.html`. |

After changing a badge, run the simulator and then `node scripts/build.js`.
