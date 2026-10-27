// The page's flow: join screen -> lobby -> raid -> back to the lobby.
// A reload during a raid rejoins it (the server holds the character for
// RECONNECT_SECONDS).

import type { Room } from '@colyseus/sdk';
import { ROOM_LOBBY } from '../../shared/constants';
import type { LobbyState, RaidState } from '../../shared/state';
import { client, errorText, raidToken, rememberProfile, savedProfile } from './net';
import { joinScreen } from './screens/join_screen';
import { lobbyScreen } from './screens/lobby_screen';
import { raidScreen } from './raid/raid_screen';
import './style.css';

const canvas = document.getElementById('scene') as HTMLCanvasElement;

async function playRaid(room: Room<any, RaidState>) {
  raidToken.set(room.reconnectionToken);
  room.onReconnect(() => raidToken.set(room.reconnectionToken));
  const { lost } = await raidScreen(room, canvas);
  raidToken.set(null);
  return lost ? 'Lost the connection to the raid.' : '';
}

async function main() {
  let error = '';
  let profile: ReturnType<typeof savedProfile> | null = null;

  // Back from a reload mid-raid? Afterwards, straight on to a lobby as before.
  const token = raidToken.get();
  if (token) {
    try {
      error = await playRaid(await client.reconnect<RaidState>(token));
      if (!error) profile = savedProfile();
    } catch {
      raidToken.set(null);
    }
  }

  for (;;) {
    profile ??= await joinScreen(error);
    error = '';
    let lobby: Room<any, LobbyState>;
    try {
      lobby = await client.joinOrCreate<LobbyState>(ROOM_LOBBY, profile);
    } catch (e) {
      error = errorText(e);
      profile = null;
      continue;
    }
    rememberProfile(profile.name, profile.role);
    const p = profile;
    const reservation = await lobbyScreen(lobby, (role) => {
      p.role = role;
      rememberProfile(p.name, role);
    });
    if (!reservation) {
      profile = null;
      continue;
    }
    try {
      error = await playRaid(await client.consumeSeatReservation<RaidState>(reservation));
    } catch (e) {
      error = errorText(e);
    }
    // Back to a lobby with the same name and role, or to the join screen to show what went wrong.
    if (error) profile = null;
  }
}

main();
