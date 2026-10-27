# Raid

A raids-only take on the MMO: no questing, no levelling. Two to five friends gather in a lobby, pick tank, healer or DPS, and queue straight into a raid instance with two bosses and trash between them. Built with three.js and Colyseus, in TypeScript.

This is the foundation: the lobby, raid instances, hosting and the scene. Combat, the classes and the raid itself come next (see [Where things go](#where-things-go)).

## Running it

You need [Node.js](https://nodejs.org) 22.12 or newer.

```
npm install
npm start
```

`npm start` builds the client and serves it and the game on one port. Open <http://localhost:2567>, pick a name and a role, and find a group. Friends open the same address (see [Hosting](#hosting)). To try a group on your own, open a second browser tab (or `http://localhost:2567/?name=Bo&role=healer`).

For development, `npm run dev` runs the server with reloads on 2567 and Vite on <http://localhost:5173> with hot reload for the client.

| Command | What it does |
| --- | --- |
| `npm start` | Build the client, then serve everything on port 2567 (`npm start -- --port 8080`) |
| `npm run serve` | The same without building |
| `npm run dev` | Server (watching) plus Vite dev server on 5173 |
| `npm test` | Lobby and raid launch tests, against a real server with real clients |
| `npm run typecheck` | `tsc --noEmit` over everything |
| `npm run build` | Build the client into `client/dist` |

## Hosting

The server serves the built client and the Colyseus rooms on one port, so a group needs only one address.

- **Same network:** friends open `http://<host's LAN address>:2567`.
- **Over the internet:** a Cloudflare quick tunnel, no port forwarding. On Windows, `start-server.cmd -HostOnline` does it all: pulls the latest code, installs, builds, opens the tunnel, prints the public `https://….trycloudflare.com` URL (and copies it to the clipboard), then runs the server in that window. It finds `cloudflared` on the PATH, in `$env:CLOUDFLARED`, or in a `cloudflared` folder next to this one; `-Cloudflared <path>` points elsewhere. `-SkipPull` and `-SkipInstall` skip steps, and other options (like `--port`) go to the server. Ctrl+C stops the server and the tunnel.
- Elsewhere: `cloudflared tunnel --url http://localhost:2567` next to `npm start`.

There are no accounts: anyone with the address can join under any free name, so only share it with friends.

## How it works

- **Lobby** (`server/rooms/LobbyRoom.ts`): the whole lobby is the party, up to 5. Players pick a role and ready up; the leader (whoever has been there longest) starts once 2 to 5 players are ready. The server locks the lobby, creates a raid room, and sends each member a seat reservation. Lobbies are made on demand, so a sixth player, or anyone arriving while a group launches, starts the next one.
- **Raid** (`server/rooms/RaidRoom.ts`): one instance per group, private, with seats reserved by name for that party only. It runs a fixed simulation at 20 Hz (`TICK_HZ`), which is empty for now. State syncs to clients through Colyseus schemas (`shared/state.ts`), which send only what changed.
- **Reconnecting:** a dropped connection keeps its character in the raid for 30 seconds (`RECONNECT_SECONDS`) while the client retries; reloading the page rejoins the same raid. Leaving the raid goes back to a lobby with the same name and role.
- **Client** (`client/src`): a plain DOM overlay for the screens and three.js for the raid. `main.ts` runs the flow: join screen, lobby, raid, back to the lobby.

```
shared/           constants, roles, message types and state schemas (client and server)
server/           Colyseus server, static file serving
  rooms/          LobbyRoom, RaidRoom
client/
  index.html
  src/
    main.ts       join -> lobby -> raid flow
    net.ts        connection, saved name/role, raid reconnect token
    screens/      join and lobby screens
    raid/         raid screen, arena, camera rig, raider views
tests/            node:test, real server + @colyseus/sdk clients
start-server.ps1  build + Cloudflare tunnel + server (start-server.cmd wraps it)
```

## Where things go

- **Combat (step 2):** movement and facing as client input applied in `RaidRoom.update()`, with positions already in `Raider` state and eased in `RaiderView`. Abilities, GCD and cooldowns as server-checked messages; tab-targeting and damage numbers on the client. Rebindable hotkeys in a client keybinding module saved like the name and role in `net.ts`. One class per role in `shared/roles.ts`. The Colyseus SDK's `Predict` helpers are an option for client-side movement prediction.
- **Raid content (step 3):** the two bosses and trash between them replace `client/src/raid/arena.ts` and drive `RaidState.encounter`.
- **Playtesting (step 4):** `start-server.cmd -HostOnline` with friends.
