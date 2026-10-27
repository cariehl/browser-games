// The lobby: who's here, their roles, ready checks, and the leader's Start.
// Resolves with a seat reservation for the raid once the leader starts, or
// null if the player leaves.

import { PARTY_MAX } from '../../shared/constants.js';
import { startBlocker } from '../../shared/messages.js';
import { ROLES, ROLE_INFO, roleCss } from '../../shared/roles.js';
import { el, show } from '../dom.js';
import { Callbacks } from '../net.js';

/** [room]: the joined lobby room. [onRole]: called with a role the player picks. */
export function lobbyScreen(room, onRole) {
  return new Promise((resolve) => {
    const panel = el('div', 'panel lobby');
    const title = el('h1', '', 'Lobby');
    const list = el('ul', 'roster');
    const notice = el('p', 'notice');
    const status = el('p', 'muted');

    const roleRow = el('div', 'roles');
    const roleButtons = ROLES.map((r) => {
      const b = el('button', 'role', ROLE_INFO[r].label);
      b.style.setProperty('--role', roleCss(r));
      b.onclick = () => {
        room.send('setRole', { role: r });
        onRole(r);
      };
      return b;
    });
    roleRow.append(...roleButtons);

    const me = () => room.state.players.get(room.sessionId);
    const ready = el('button', '', 'Ready');
    ready.onclick = () => room.send('setReady', { ready: !me()?.ready });
    const start = el('button', 'primary', 'Start raid');
    start.onclick = () => room.send('start', {});
    const leave = el('button', 'quiet', 'Leave');
    leave.onclick = () => {
      room.removeAllListeners();
      room.leave();
      resolve(null);
    };
    const actions = el('div', 'actions');
    actions.append(ready, start, leave);
    panel.append(title, list, roleRow, actions, status, notice);
    show(panel);

    const render = () => {
      if (!room.state.players) return; // The first state hasn't arrived yet.
      const players = [...room.state.players.entries()];
      title.textContent = `Lobby (${players.length}/${PARTY_MAX})`;
      list.replaceChildren(...players.map(([id, p]) => {
        const li = el('li');
        const role = el('span', 'tag', ROLE_INFO[p.role]?.label ?? p.role);
        role.style.setProperty('--role', roleCss(p.role));
        li.append(role, el('span', 'name', p.name + (id === room.sessionId ? ' (you)' : '')));
        if (id === room.state.leaderId) li.append(el('span', 'muted small', 'leader'));
        li.append(el('span', p.ready ? 'ready yes' : 'ready', p.ready ? 'Ready' : 'Not ready'));
        return li;
      }));
      const mine = me();
      for (const [i, b] of roleButtons.entries()) b.classList.toggle('picked', mine?.role === ROLES[i]);
      ready.textContent = mine?.ready ? 'Not ready' : 'Ready';
      const leader = room.state.leaderId === room.sessionId;
      const blocker = startBlocker(players.map(([, p]) => p));
      start.hidden = !leader;
      start.disabled = !!blocker || room.state.launching;
      status.textContent = room.state.launching ? 'Entering the raid…'
        : blocker ?? (leader ? 'Everyone is ready. Start when you like.' : 'Waiting for the leader to start.');
    };

    const callbacks = Callbacks.get(room);
    callbacks.onAdd('players', (player) => {
      callbacks.onChange(player, render);
      render();
    });
    callbacks.onRemove('players', render);
    callbacks.listen('leaderId', render);
    callbacks.listen('launching', render);
    render();

    room.onMessage('notice', ({ text }) => {
      notice.textContent = text;
    });
    room.onMessage('launch', ({ reservation }) => {
      room.removeAllListeners();
      room.leave();
      resolve(reservation);
    });
    room.onLeave(() => resolve(null));
  });
}
