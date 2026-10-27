# Raid game

Plain JavaScript ES modules, no build step, like Mechscape (github.com/cariehl/mechscape-threejs). three.js client, Colyseus 0.18 server. See README.md for layout and commands.

- Before finishing a change: `npm test`, and load the page in a browser if the client changed.
- The browser loads `client/` and `shared/` files as they are: imports need explicit `.js` extensions and relative paths. `three` comes through the import map in index.html; the Colyseus client is `window.Colyseus` from a plain script.
- Browser libraries are copied into `vendor/` by `npm run vendor` (after upgrading three or @colyseus/sdk). Don't import from node_modules in client code.
- `shared/` must not import server-only packages. Schemas live in `server/state.js` and use the `schema({ field: t.string() })` API from @colyseus/schema 5.
- The server is authoritative: validate every client message's fields before using them.
- `start-server.ps1` is the Windows hosting path (Cloudflare quick tunnel); keep it working when changing ports or start commands.
