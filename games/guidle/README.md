# GUIDle

A daily browser game: once a day you roll a random UUID. The game scans each ID for fun patterns
(runs, palindromes, counting sequences, hex words like `C0FFEE`, famous numbers like `404`)
and awards badges for them. Rarer badges score more points, a roll scores the sum of its
badges, and beating your high score sets off a celebration.

Play it at https://cariehl.github.io/guidle/, or open `index.html` in any modern browser. Press **Space** or click **Roll**.
Pressing Roll again while the ID is spinning skips the spin. As each badge is revealed, the
characters it matched light up; hover or tap any badge afterwards to light them up again.

## Daily roll

You get one roll per day, and a new one unlocks at midnight in your own time zone. Days are numbered
from GUIDle #0 on 2 November 2026, so 3 November is GUIDle #1. History keeps every day's roll with its date and time, and you can
replay any of them. **Share result** copies a summary with the day number, rating, and Top X%.

Each roll gets a rating from Common to Mythic and a "Top X%": the share of all rolls that score at
least as much. Both come from the score distribution of 8 million simulated rolls (`src/scores.json`);
above the range the simulation covers well, the share is the summed odds of the badges worth that much
on their own. The rating uses the same odds bands as the badge tiers, except that a roll is Uncommon from
Top 25%: Common above 25%, Uncommon down to 5%, Rare to 0.5%, Epic to 0.05%, Legendary to
1 in a million, and Mythic beyond.

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

Roll history, lifetime badge counts, and your high score are saved in
`localStorage` in your browser.

## Project layout

| Path | What it is |
| --- | --- |
| `src/badges.js` | Badge engine: pattern detectors, ladders, scoring. Runs in the browser and in Node. |
| `src/page.html` | Page markup, styles, and game UI. |
| `src/odds.json` | Odds per badge and how each was worked out. |
| `scripts/simulate-odds.js` | Regenerates `src/odds.json` (`node scripts/simulate-odds.js 24000000`, about 10 minutes on 4 cores). |
| `src/scores.json` | Simulated distribution of roll scores, for ratings and Top X%. |
| `scripts/simulate-scores.js` | Regenerates `src/scores.json` (`node scripts/simulate-scores.js 8000000`, about 4 minutes). Run it after `simulate-odds.js`. |
| `scripts/build.js` | Inlines everything into the standalone `index.html`. |

After changing a badge, run the simulator and then `node scripts/build.js`.

To update the live site, copy the built `index.html` to `guidle/index.html` in [cariehl.github.io](https://github.com/cariehl/cariehl.github.io) and push to `master`.
