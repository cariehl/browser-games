# 🔮 Orbs of Magic

A multiplayer tactical card battler. Two wizards summon units onto a hex battlefield, give them orders, and race to shatter the enemy **Sanctum**. Built with **three.js** (client), **Colyseus** (server) and **TypeScript** everywhere.

## Quick start

```bash
npm install
npm run dev        # server on :2567 + Vite client on :5173 → open http://localhost:5173
```

Production build (one process serves the game and the client):

```bash
npm run build
npm start          # → http://localhost:2567
```

### Hosting on Windows

Double-click `start-server.cmd` (or run `.\start-server.ps1`). It pulls the latest code, runs `npm install` and `npm run build`, then hosts the game on http://localhost:2567 in that window. Ctrl+C stops it.

| Option | What it does |
| --- | --- |
| `-HostOnline` | Opens a Cloudflare quick tunnel and prints a public URL for friends (copied to the clipboard). Needs `cloudflared`: on PATH, in `$env:CLOUDFLARED`, at `..\cloudflared\cloudflared.exe`, or given with `-Cloudflared <path>` |
| `--port 8080` | Listens on another port (`$env:PORT` works too) |
| `-SkipPull` / `-SkipInstall` / `-SkipBuild` | Skips that step |

Example from cmd or a shortcut: `start-server.cmd -HostOnline`.

Other scripts:

| Script | What it does |
| --- | --- |
| `npm run sim -- 10` | Plays every deck against every other deck 10 times with the AI and prints win rates |
| `npx tsx scripts/trace.ts wildfire night_court 42` | Play-by-play of a single AI game (deck A, deck B, seed) |
| `npm run typecheck` | TypeScript check of client, server and shared code |

## How to play

- **Goal:** reduce the enemy Sanctum from 20 to 0.
- **Rounds (Legends of Runeterra style):** each round both players gain a mana crystal (max 10) and draw a card. Players alternate taking **one action at a time**: play a card, order a unit, or pass. The round ends when both players pass back to back. The **initiative** (who acts first) swaps every round.
- **Units** are summoned onto your two back rows (your *territory*). They can't act the round they arrive unless they're **Swift**. An **order** moves a unit up to its speed (usually 2) and/or attacks something in range.
- **Combat:** attacker and defender damage each other simultaneously unless the defender can't reach back (ranged attacks). Damage persists between rounds.
- **Sanctum attacks:** a unit standing in *enemy territory* (their two back rows) can attack their Sanctum.
- **Ley Orbs:** three orbs hover over the centre row. Each one you stand on at the start of a round gives you +1 mana that round and deals 1 damage to the enemy Sanctum.
- **Spell mana:** up to 3 unspent mana carries over, usable only for Spells and Orders.
- Card types: **Units**, **Spells** (instant effects) and **Orders** (effects that command your units: ready them, buff them, make them fight).

- **Champions:** each Orb has a champion that levels up mid-battle when its condition is met (Pyra: deal 8 Sanctum damage; Nerith: cast 5 spells/orders; Thornak: reach 8 max mana; Sera: control 5 units; Morvath: lose 5 allies). Hover a champion to see its progress and its leveled-up form.

Keywords: Swift, Guardian, Flying, First Strike, Drain, Regenerate, Barrier, Siege, Deadly, Infiltrate, plus Freeze and Root statuses. Hover anything in-game for details.

## The Five Orbs

| Color | Orb | Stands for | Plays like |
| --- | --- | --- | --- |
| 🔥 Ember | Orb of Passion | Freedom, fury, the thrill of the moment | Swift units, Siege, burn straight to the Sanctum |
| 🌊 Tide | Orb of Insight | Knowledge, patience, control | Freeze, bounce and reposition enemies, draw cards, sea monsters |
| 🌿 Grove | Orb of Life | Growth, instinct, endurance | Extra mana crystals, huge Regenerating creatures, fight effects |
| ☀️ Dawn | Orb of Order | Unity, justice, protection | Guardians, Barriers, healing, wide armies that buff each other |
| 🌑 Dusk | Orb of Ambition | Power at any price | Sacrifice, Drain, Deadly assassins, death-trigger combos |

## Decks

| Deck | Colors | Archetype |
| --- | --- | --- |
| Wildfire | Ember | Aggro |
| Frozen Bastion | Tide / Dawn | Control |
| Ancient Awakening | Grove / Tide | Ramp |
| Silver Vanguard | Dawn / Grove | Midrange |
| Grave Pact | Dusk / Ember | Combo |
| Storm Raiders | Ember / Tide | Tempo |
| Legion of Dawn | Dawn / Dusk | Go-wide |
| Wild Hunt | Grove / Ember | Stompy |
| Night Court | Dusk / Tide | Attrition |

## Deck builder

Pick **New Deck** (or **Copy & edit** on any deck) in the main menu. Decks are exactly 30 cards, up to 3 copies of a card, and at most 2 colors. Custom decks are saved in your browser and work in every mode, including online matches (the server re-validates them).

## Multiplayer

- **Battle the AI**: a private room with a server-side AI opponent.
- **Quick Match**: joins any open public room or creates one.
- **Private Match**: creates a room and shows a code; your friend enters it under *Join*.
- Each action has a 75 second timer (auto-pass). Disconnected players have 60 seconds to reconnect (refreshing the page reconnects automatically).

## Code layout

```
shared/   rules engine (engine.ts), cards, decks, hex math, AI — used by both server and client
server/   Colyseus server; DuelRoom sends each player a filtered view of the game plus animation events
client/   three.js scene (scene.ts), HUD and input (game.ts), menus (main.ts)
scripts/  AI simulation and trace tools for balancing
```

The server is authoritative: clients send actions (`play`, `order`, `pass`, …), the shared engine validates them, and every client receives its own view (opponent hand and deck order hidden) along with the list of events to animate.
