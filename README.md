# browser-games

Browser games and apps by cariehl, in one repo. Most of the games are on https://cariehl.github.io/.

| Folder | What it is | Live | Came from |
| --- | --- | --- | --- |
| [games/orbs-of-magic](games/orbs-of-magic) | Orbs of Magic, a tactical card battler (Vite + TypeScript, Colyseus server) | [/orbs/](https://cariehl.github.io/orbs/) | cariehl/orbs-of-magic-threejs |
| [games/guidle](games/guidle) | GUIDle, a daily UUID badge game | [/guidle/](https://cariehl.github.io/guidle/) | cariehl/guidle |
| [games/hexbound](games/hexbound) | Hexbound Tactics, a turn-based tactics roguelite | [/hexbound/](https://cariehl.github.io/hexbound/) | cariehl/hexbound-threejs |
| [games/hexmancer](games/hexmancer) | Hexmancer (single file) | [/hexmancer/](https://cariehl.github.io/hexmancer/) | cariehl.github.io `hexmancer/` |
| [games/overcharge](games/overcharge) | Overcharge, a third-person roguelite shooter (single file) | [/overcharge/](https://cariehl.github.io/overcharge/) | cariehl.github.io `overcharge/` |
| [games/mechscape](games/mechscape) | MechScape (plain ES modules, Node game server) | [/mechscape/](https://cariehl.github.io/mechscape/) | cariehl/mechscape-threejs |
| [games/deep-space](games/deep-space) | Deep Space, an idle survival game with a talent constellation (plain scripts) | not hosted yet | new |
| [games/wow-clone](games/wow-clone) | Raid, a raids-only MMO (three.js, Colyseus 0.18 server) | not hosted yet | cariehl/wow-clone-threejs |
| [apps/on-the-wire](apps/on-the-wire) | On the Wire, an embedded protocols course with an in-browser C sandbox (single file) | not hosted yet | a Claude artifact |
| [apps/signalbench](apps/signalbench) | SignalBench, a virtual hardware bench for embedded C firmware (C firmware, Rust sim, Tauri desktop app) | desktop app | cariehl/SignalBench |
| [site](site) | The games front page, its thumbnails (`img/`) and each game's commentary (`commentary/`) | [/](https://cariehl.github.io/) | cariehl.github.io |

Each folder keeps its own README, `package.json` and commands, so work inside a game the same way as before, from its folder. Git history came along: `git log -- games/guidle` shows GUIDle's commits from its old repo.

## Building the site

```
node scripts/build-site.mjs
```

This builds every game on the site that has a build step and writes `dist/`, laid out exactly like cariehl.github.io (`orbs/`, `guidle/`, `hexbound/`, `hexmancer/`, `overcharge/`, `mechscape/`, plus the front page, `img/` and `commentary/`). `--no-build` skips the per-game builds and only assembles. To publish, copy `dist/` over cariehl.github.io and push `master`.

Game folders on the site keep the short URL paths (`orbs/`, not `orbs-of-magic/`), so links people already have keep working. To put a game on the site, add it to `GAMES` in `scripts/build-site.mjs`, and add a card and a 16:9 thumbnail to `site/` (see the comment in `site/index.html`). Commentary for a game goes in `site/commentary/<slug>.md`; each game's menu shows a Commentary button only while that file exists.

Deep Space, Raid, On the Wire and SignalBench are not part of the site build.

## CI

SignalBench's CI lives at `.github/workflows/signalbench.yml` and runs only when `apps/signalbench/` changes.
