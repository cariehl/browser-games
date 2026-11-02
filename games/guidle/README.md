# GUIDle

A browser game where every roll is a random UUID. The game scans each ID for fun patterns
(runs, palindromes, counting sequences, hex words like `C0FFEE`, famous numbers like `404`)
and awards badges for them. Rarer badges score more points, a roll scores the sum of its
badges, and beating your high score sets off a celebration.

Open `index.html` in any modern browser to play. Press **Space** or click **Roll**.
Clicking Roll again while the ID is spinning skips the spin. As each badge is revealed, the
characters it matched light up; hover or tap any badge afterwards to light them up again.

## How scoring works

Like RNGdle, a badge is worth its odds: a pattern that turns up 1 in N rolls scores about N points,
and a roll scores the sum of its badges.

Each badge's odds come from one of three methods, shown in the badge collection:

- **Exact**: closed-form probability (for example "the first and last characters match" is exactly 1 in 16).
  These account for the fixed characters in a version 4 UUID.
- **Simulated**: the share of 24 million random rolls that earned the badge (only used with at least 100 hits).
- **Estimated**: for patterns too rare to simulate well, such as `C0FFEE`, a rough closed-form estimate
  rounded to the nearest of 1, 5, 10, 50, 100, 500... (so ≈ 1 in 1,000,000 or ≈ 1 in 50,000,000).

Simulated and exact scores are rounded to two significant figures. Tiers follow the odds:
Common (under 1 in 20), Uncommon (to 1 in 200), Rare (to 1 in 2,000), Epic (to 1 in 20,000),
Legendary (to 1 in a million), and Mythic beyond that.

Some badges are a ladder (for example Hat Trick → Four of a Kind → High Five → Broken Record);
only the highest rung on a ladder is awarded. A roll with no patterns earns **Perfectly Average**.

Roll history (last 250 rolls), lifetime badge counts, and your high score are saved in
`localStorage` in your browser.

## Project layout

| Path | What it is |
| --- | --- |
| `src/badges.js` | Badge engine: pattern detectors, ladders, scoring. Runs in the browser and in Node. |
| `src/page.html` | Page markup, styles, and game UI. |
| `src/odds.json` | Odds per badge and how each was worked out. |
| `scripts/simulate-odds.js` | Regenerates `src/odds.json` (`node scripts/simulate-odds.js 24000000`, about 10 minutes on 4 cores). |
| `scripts/build.js` | Inlines everything into the standalone `index.html`. |

After changing a badge, run the simulator and then `node scripts/build.js`.
