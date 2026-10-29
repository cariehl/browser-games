import { Client } from 'colyseus.js';

function serverUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // In dev, Vite serves the client on :5173 and the game server runs on :2567.
  if (import.meta.env.DEV) return `${proto}://${location.hostname}:2567`;
  return `${proto}://${location.host}`;
}

export const client = new Client(serverUrl());
