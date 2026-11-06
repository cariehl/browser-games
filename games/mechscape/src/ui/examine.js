// The two "look at it" options every right-click menu ends with, OSRS
// style: Inspect opens a card of stats (only for things that have some),
// and Examine asks the server for the thing's description, which lands in
// the chat box on the next tick.

import { ClientState } from '../client/client_state.js';
import { ExamineAction } from '../sim/actions.js';

/** Whether an InspectInfo card has anything worth opening it for. */
export function hasInspect(info) {
  return !!(info && info.rows && info.rows.length);
}

/**
 * Inspect (when [source]() has stats) then Examine (when [kind] and [defId]
 * are given), both right-click only. [look] marks them so menus can put
 * "Walk here" above them.
 */
export function lookOptions({ link, inspector, target, color, x, y, source = null, live = true, kind = null, defId = null }) {
  const options = [];
  if (source && hasInspect(source())) {
    options.push({ verb: 'Inspect', target, color, rightOnly: true, look: true, action: () => inspector.open(source, x, y, live) });
  }
  if (kind && defId) {
    options.push({ verb: 'Examine', target, color, rightOnly: true, look: true, action: () => link.send(ClientState.localPlayerId, new ExamineAction(kind, defId)) });
  }
  return options;
}
