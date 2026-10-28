# Raid

A raids-only take on the MMO: no questing, no levelling. Two to five friends gather in a lobby, pick tank, healer or DPS, and queue straight into a raid instance with two bosses and trash between them. Built with three.js and Colyseus, in plain JavaScript with no build step.

So far: the lobby, raid instances, hosting, and the combat system with one class per role, tested on practice targets in the hall. The raid itself (trash and two bosses) comes next (see [Where things go](#where-things-go)).

## Running it

You need [Node.js](https://nodejs.org) 22 or newer (Colyseus 0.18 requires it).

```
npm install
npm start
```

Open <http://localhost:2567>, pick a name and a role, and find a group. Friends open the same address (see [Hosting](#hosting)). To try a group on your own, open a second browser tab (or `http://localhost:2567/?name=Bo&role=healer`).

There's no build: the browser loads `index.html`, `client/` and `shared/` exactly as they are, so a client change only needs a page reload.

| Command | What it does |
| --- | --- |
| `npm start` | Serve the game on port 2567 (`npm start -- --port 8080`) |
| `npm run dev` | The same, restarting when `server/` or `shared/` changes |
| `npm test` | Lobby, raid launch and combat tests (combat directly, the rest against a real server with real clients) |
| `npm run vendor` | Copy three.js and the Colyseus client into `vendor/` (after upgrading either) |

## Hosting

The server serves the game's files and the Colyseus rooms on one port, so a group needs only one address.

- **Same network:** friends open `http://<host's LAN address>:2567`.
- **Over the internet:** a Cloudflare quick tunnel, no port forwarding. On Windows, `start-server.cmd -HostOnline` does it all: pulls the latest code, installs, opens the tunnel, prints the public `https://….trycloudflare.com` URL (and copies it to the clipboard), then runs the server in that window. It finds `cloudflared` on the PATH, in `$env:CLOUDFLARED`, or in a `cloudflared` folder next to this one; `-Cloudflared <path>` points elsewhere. `-SkipPull` and `-SkipInstall` skip steps, and other options (like `--port`) go to the server. Ctrl+C stops the server and the tunnel.
- Elsewhere: `cloudflared tunnel --url http://localhost:2567` next to `npm start`.

There are no accounts: anyone with the address can join under any free name, so only share it with friends.

## Playing

| | Default |
| --- | --- |
| Move, turn | W S, A D |
| Strafe | Q E |
| Autorun | middle mouse button (W or S cancels it) |
| Look around | left-drag (the cursor hides while dragging) |
| Steer | right-drag: the character turns with the camera, and A and D strafe |
| Run forward | hold both mouse buttons |
| Abilities | 1 to 8, or click the action bar |
| Target | left-click a unit or a party frame, Tab (next enemy), F1 yourself, F2 to F5 party members |
| Attack | right-click an enemy: targets it and starts auto-attack (melee abilities start it too) |
| Stop casting, then clear target | Esc (clicking empty ground keeps your target) |

Every key can be rebound from **Keybindings** in the raid, to a key or to the middle or side mouse buttons (saved in the browser). The wheel zooms.

| Class | Role | Abilities | Talent trees |
| --- | --- | --- | --- |
| Guardian | Tank | Strike, Shield Slam (extra threat), Thunder Clap (area), Taunt, Shield Wall (half damage taken) | Protection, Arms, Thunder |
| Cleric | Healer | Smite (cast), Flash Heal (cast), Renew (heal over time), Holy Word (big instant), Circle of Healing (area) | Holy, Discipline, Retribution |
| Sorcerer | DPS | Firebolt (cast), Fire Blast, Ignite (damage over time), Arcane Explosion (area), Arcane Power (+30% damage) | Fire, Frost, Arcane |

**Talents.** On first spawning in a raid, everyone spends 10 talent points before they can move or fight, and the build is locked for that raid. Each class has three trees of five talents; each tier needs 2 more points in that tree, and the last tier is a capstone that teaches a new ability (Frost also teaches Frostbolt in its first tier). A tree holds 11 points, so a build is always a trade-off: the capstone plus a few points elsewhere, or a hybrid. "Fill" spends a ready-made build down one tree, and the last build for each class is remembered. Trees and talents are data in `shared/talents.js`.

**Damage meter.** Bottom right: damage or healing (effective, so overhealing doesn't count) per raider and per second for the current fight, which starts with the first hit after 5 quiet seconds. Hover a row for its breakdown by ability.

Abilities share a 1.5 second global cooldown unless they say otherwise; pressing one in the last 0.75 seconds of the GCD, a cast or its cooldown queues it, and it goes off the moment it's ready (the queued button is outlined; Esc drops it). Shift-click (or shift-drag) an action button to pick it up and click another slot to swap them; the bar order is saved per class, and the slot's key follows the new position. Moving cancels a cast. Hostile abilities need the target in range and in front of you. The hall has two training dummies (they never die and reset after 10 seconds alone) and a Sparring Golem, which fights back: it attacks whoever has the most threat, chases them, gives up if pulled too far from home, and respawns 10 seconds after dying. Auto-attack swings every 2 seconds while the target is in melee reach and in front of you, and pauses while you cast. Dead raiders release to respawn at the entrance.

## How it works

- **Lobby** (`server/rooms/lobby_room.js`): the whole lobby is the party, up to 5. Players pick a role and ready up; the leader (whoever has been there longest) starts once 2 to 5 players are ready. The server locks the lobby, creates a raid room, and sends each member a seat reservation. Lobbies are made on demand, so a sixth player, or anyone arriving while a group launches, starts the next one.
- **Raid** (`server/rooms/raid_room.js`): one instance per group, private, with seats reserved by name for that party only. It checks each player message (`shared/messages.js`) and hands it to the simulation, which runs at 20 Hz (`TICK_HZ`). State syncs to clients through Colyseus schemas (`server/state.js`), which send only what changed.
- **Combat** (`server/world.js`): the server is authoritative. Clients send the movement keys they hold and where they face; the server moves them (`stepMovement` in `shared/combat.js`, kept inside the walls and pillars of `shared/arena.js`). Abilities are requests: the server checks the GCD, cooldowns, target, range and facing, runs casts, applies damage, healing and auras, keeps each enemy's threat table, and runs the enemies. It reports hits as `hit` messages (for floating numbers) and refusals as `error` messages. Classes and abilities are data in `shared/classes.js`, talents in `shared/talents.js` (folded into combat through `talentStats`), enemy kinds in `shared/enemies.js`. `RaidState.time` is the clock every cast, cooldown and aura time is measured against.
- **Client prediction** (`client/raid/controls.js`): the player's own character moves at once with the same `stepMovement` and is pulled toward the server's position when they drift apart, so movement feels immediate over a tunnel. Everyone else eases toward their synced positions.
- **Reconnecting:** a dropped connection keeps its character in the raid for 30 seconds (`RECONNECT_SECONDS`) while the client retries; reloading the page rejoins the same raid. Leaving the raid goes back to a lobby with the same name and role.
- **Client** (`client/`): a plain DOM overlay for the screens and three.js for the raid. `main.js` runs the flow: join screen, lobby, raid, back to the lobby. three.js loads through the import map in `index.html`; the Colyseus client is a plain script that sets `window.Colyseus`.

```
index.html, style.css
client/           browser code
  main.js         join -> lobby -> raid flow
  net.js          connection, saved name/role, raid reconnect token
  screens/        join and lobby screens
  keybinds.js     rebindable keys, saved in the browser
  raid/           raid screen, HUD, controls, camera rig, unit views, combat text
shared/           constants, roles, classes, enemies, arena, movement, message rules (browser and server)
server/           Colyseus server, state schemas, the combat simulation (world.js), static file serving
  rooms/          lobby_room.js, raid_room.js
vendor/           three.js and the Colyseus client, copied by npm run vendor
tests/            node:test, real server + @colyseus/sdk clients
tools/            vendor.js
start-server.ps1  install + Cloudflare tunnel + server (start-server.cmd wraps it)
```

## Where things go

- **Raid content (step 3):** the two bosses and trash between them replace the practice targets (`PRACTICE_SPAWNS` in `shared/enemies.js`) and `client/raid/arena.js`, and drive `RaidState.encounter`. New enemy kinds go in `ENEMY_KINDS`; boss mechanics (casts, area attacks) extend `RaidWorld.think()`, and enemy casts already show on the target frame.
- **Playtesting (step 4):** `start-server.cmd -HostOnline` with friends.
