// The page's flow: join screen -> lobby -> raid -> back to the lobby.
// A reload during a raid rejoins it (the server holds the character for
// RECONNECT_SECONDS).

import { ROOM_LOBBY } from '../shared/constants.js';
import { client, errorText, raidToken, rememberProfile, savedProfile } from './net.js';
import { joinScreen } from './screens/join_screen.js';
import { lobbyScreen } from './screens/lobby_screen.js';
import { raidScreen } from './raid/raid_screen.js';

const canvas = document.getElementById('scene');

/** Plays a joined raid room until the player leaves. Resolves to an error to show, or ''. */
async function playRaid(room) {
  raidToken.set(room.reconnectionToken);
  room.onReconnect(() => raidToken.set(room.reconnectionToken));
  const { lost } = await raidScreen(room, canvas);
  raidToken.set(null);
  return lost ? 'Lost the connection to the raid.' : '';
}

async function main() {
  let error = '';
  let profile = null;

  // Back from a reload mid-raid? Afterwards, straight on to a lobby as before.
  const token = raidToken.get();
  if (token) {
    try {
      error = await playRaid(await client.reconnect(token));
      if (!error) profile = savedProfile();
    } catch {
      raidToken.set(null);
    }
  }

  for (;;) {
    profile ??= await joinScreen(error);
    error = '';
    let lobby;
    try {
      lobby = await client.joinOrCreate(ROOM_LOBBY, profile);
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
      error = await playRaid(await client.consumeSeatReservation(reservation));
    } catch (e) {
      error = errorText(e);
    }
    // Back to a lobby with the same name and role, or to the join screen to show what went wrong.
    if (error) profile = null;
  }
}

main();
