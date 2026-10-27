// The first screen: a name and a role, then into a lobby.

import { NAME_MAX } from '../../../shared/constants';
import { ROLES, ROLE_INFO, type Role } from '../../../shared/roles';
import { el, show } from '../dom';
import { endpoint, savedProfile } from '../net';

/** Shows the join form; resolves with what the player picked. [error] says why the last try failed. */
export function joinScreen(error = ''): Promise<{ name: string; role: Role }> {
  return new Promise((resolve) => {
    const saved = savedProfile();
    const form = el('form', 'panel join');
    form.append(el('h1', '', 'Raid'), el('p', 'muted', 'Gather 2 to 5 players, pick roles, and go.'));
    if (error) form.append(el('p', 'error', error));

    const nameLabel = el('label', '', 'Name');
    const name = el('input');
    Object.assign(name, { maxLength: NAME_MAX, value: saved.name, autocomplete: 'nickname', spellcheck: false, required: true });
    nameLabel.append(name);

    let role: Role = saved.role;
    const roles = el('div', 'roles');
    const buttons = ROLES.map((r) => {
      const b = el('button', 'role', ROLE_INFO[r].label);
      b.type = 'button';
      b.style.setProperty('--role', `#${ROLE_INFO[r].color.toString(16).padStart(6, '0')}`);
      b.onclick = () => {
        role = r;
        for (const other of buttons) other.classList.toggle('picked', other === b);
      };
      b.classList.toggle('picked', r === role);
      return b;
    });
    roles.append(...buttons);

    const info = el('p', 'muted small');
    fetch(`${endpoint}/server-info`).then((r) => r.json()).then((s: { raids: number }) => {
      info.textContent = s.raids ? `${s.raids} raid${s.raids === 1 ? '' : 's'} in progress` : '';
    }).catch(() => {});

    const go = el('button', 'primary', 'Find a group');
    go.type = 'submit';
    form.append(nameLabel, el('div', 'label', 'Role'), roles, go, info);
    form.onsubmit = (e) => {
      e.preventDefault();
      resolve({ name: name.value.trim(), role });
    };
    show(form);
    name.focus();
  });
}
