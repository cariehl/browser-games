# Raid game

TypeScript, three.js client (Vite), Colyseus 0.18 server run with tsx (no server build step). See README.md for layout and commands.

- Before finishing a change: `npm run typecheck && npm test && npm run build`.
- Shared code (constants, roles, messages, schemas) lives in `shared/` and is imported by both sides with relative paths.
- Schemas use the `schema({ field: t.string() })` API from @colyseus/schema 5, not decorators.
- The server is authoritative: validate every client message's fields before using them.
- `start-server.ps1` is the Windows hosting path (Cloudflare quick tunnel); keep it working when changing ports, build or start commands.
