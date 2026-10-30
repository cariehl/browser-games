// Keyword glossary and the side popups that explain them next to a tooltip.
// Keywords mentioned inside another keyword's text are pulled in too, so a popup for
// "Flanking" also explains "Combat advantage".
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // id: { name, text, match (regex source, matched case-insensitively on word boundaries), cls }
  const KW = {
    // conditions
    prone: { name: 'Prone', icon: '⤓', cls: 'cond', match: 'prone', text: 'Knocked flat. Melee attackers have combat advantage against it, it gets +2 defenses against ranged attacks, and it takes −2 to its own ranged and area attacks. Standing up costs a move action.' },
    dazed: { name: 'Dazed', icon: '💫', cls: 'cond', match: 'dazed', text: 'Gets only one action on its turn (standard, move or minor) and can\'t make opportunity attacks. Attackers have combat advantage against it.' },
    stunned: { name: 'Stunned', icon: '✸', cls: 'cond', match: 'stunned', text: 'Can\'t take actions or make opportunity attacks. Attackers have combat advantage against it.' },
    asleep: { name: 'Asleep', icon: 'Z', cls: 'cond', match: 'asleep|drowsy', text: 'Can\'t take actions. Attackers have combat advantage against it. Taking any damage wakes it up.' },
    slowed: { name: 'Slowed', icon: '🐌', cls: 'cond', match: 'slowed|creamed', text: 'Speed drops to 2 hexes.' },
    immobilized: { name: 'Immobilized', icon: '⛓', cls: 'cond', match: 'immobilized|glazed|jammed', text: 'Can\'t move from its hex (speed 0), though it can still be pushed, pulled or slid.' },
    weakened: { name: 'Weakened', icon: '↓', cls: 'cond', match: 'weakened', text: 'Deals only half damage with its attacks.' },
    blinded: { name: 'Blinded', icon: '◌', cls: 'cond', match: 'blinded', text: 'Takes −5 to attack rolls, and everyone has combat advantage against it.' },
    marked: { name: 'Marked', icon: '◎', cls: 'cond', match: 'marked|marks?', text: 'Takes −2 to attack rolls against anyone except the creature that marked it. A creature can carry only one mark; a new mark replaces the old one.' },
    ongoing: { name: 'Ongoing damage', icon: '🔥', cls: 'cond', match: 'ongoing(?: \\d+)?(?: damage)?|burning', text: 'Takes the listed damage at the start of each of its turns until it succeeds on a saving throw.' },
    exposed: { name: 'Exposed', icon: '⚠', cls: 'cond', match: 'exposed', text: 'Grants combat advantage, either to one attacker or to everyone, depending on the power that caused it.' },
    vulnerable: { name: 'Vulnerable', icon: '✚', cls: 'cond', match: 'vulnerable(?: \\d+)?', text: 'Takes extra damage from every hit by the listed amount.' },
    hidden: { name: 'Hidden', icon: '👁', cls: 'good', match: 'hidden', text: 'Has combat advantage on its next attack. Attacking ends it.' },
    quarry: { name: 'Quarry', icon: '⌖', cls: 'cond', match: 'quarry', text: 'The Ranger\'s chosen prey. The Ranger deals extra damage to it once per turn.' },
    dying: { name: 'Dying', icon: '☠', cls: 'bad', match: 'dying|death saves?', text: 'At 0 HP or less. Rolls a death save at the start of each turn: under 10 is a failure, and three failures and the hero dies. A natural 20 gets them back up. Taking damage while dying also counts as a failure. Any healing brings them back.' },
    bloodied: { name: 'Bloodied', icon: '🩸', cls: 'bad', match: 'bloodied', text: 'At half HP or less. Some powers and monsters react to it: bosses often change tactics once bloodied.' },
    // durations and saves
    saveEnds: { name: 'Save ends', cls: 'rule', match: 'save ends|saving throws?', text: 'At the end of each of its turns the creature rolls a d20: 10 or higher removes the effect.' },
    eont: { name: 'Until end of next turn', cls: 'rule', match: 'until end of next turn', text: 'Lasts until the end of the next turn of whoever caused it.' },
    // combat rules
    ca: { name: 'Combat advantage', cls: 'good', match: 'combat advantage|adv', text: '+2 to attack rolls against the target. You get it by flanking, or when the target is prone (melee only), dazed, stunned, asleep, blinded, dying or exposed. Rogues get it against enemies that haven\'t acted yet (First Strike) and add Sneak Attack damage.' },
    flank: { name: 'Flanking', cls: 'good', match: 'flanking|flank', text: 'You and an ally stand on directly opposite sides of an enemy. Both of you have combat advantage against it.' },
    firstStrike: { name: 'First Strike', cls: 'good', match: 'first strike', text: 'Rogue feature: combat advantage against any enemy that hasn\'t taken a turn yet this fight.' },
    sneak: { name: 'Sneak Attack', cls: 'good', match: 'sneak attack', text: 'Rogue feature: once per turn, a weapon attack with combat advantage deals extra damage.' },
    oa: { name: 'Opportunity attack', cls: 'rule', match: 'opportunity attacks?|provokes?', text: 'A free melee basic attack against an adjacent enemy that leaves your reach, or that makes a ranged or area attack next to you. Shifting doesn\'t provoke.' },
    shift: { name: 'Shift', cls: 'rule', match: 'shifts?', text: 'Move 1 hex carefully. Shifting never provokes opportunity attacks.' },
    forced: { name: 'Push, pull, slide', cls: 'rule', match: 'push(?: \\d+)?|pull(?: \\d+)?|slide(?: \\d+)?', text: 'Forced movement. Push moves the target away from you, pull moves it closer, and slide moves it anywhere. It doesn\'t provoke opportunity attacks, and can shove a target into hazards.' },
    surge: { name: 'Healing surge', cls: 'heal', match: '(?:healing )?surges?', text: 'Each hero has a few per fight. Spending one heals a quarter of max HP. Second Wind and Cleric heals spend one; Warlord rallies give temporary HP instead.' },
    temp: { name: 'Temporary HP', cls: 'heal', match: 'temp(?:orary)? hp', text: 'A buffer that absorbs damage before real HP. It doesn\'t stack: a new grant replaces the old one if it\'s bigger.' },
    crit: { name: 'Critical hit', cls: 'good', match: 'crit(?:ical hit)?s?|natural 20', text: 'A natural 20 always hits and deals maximum damage. Heroes earn Momentum from crits.' },
    momentum: { name: 'Momentum', cls: 'good', match: 'momentum', text: 'A party resource earned by kills and critical hits. Spend 2 to reroll a missed attack.' },
    // power cadence
    atwill: { name: 'At-Will', cls: 'atwill', match: 'at-will', text: 'Use it as often as you like.' },
    encounter: { name: 'Encounter', cls: 'encounter', match: 'encounter', text: 'Once per fight.' },
    daily: { name: 'Daily', cls: 'daily', match: 'daily', text: 'Your big once-per-fight finisher. Save it for when it counts.' },
    closeBurst: { name: 'Close burst', cls: 'rule', match: 'close burst(?: \\d+)?', text: 'Hits every hex within that many hexes of you. Close attacks don\'t provoke opportunity attacks.' },
    closeBlast: { name: 'Close blast', cls: 'rule', match: 'close blast(?: \\d+)?', text: 'Hits a block of hexes next to you, in the direction you choose.' },
    areaBurst: { name: 'Area burst', cls: 'rule', match: 'area burst(?: \\d+)?', text: 'Hits every hex within that many hexes of a point you pick in range. It provokes like a ranged attack.' },
    // monster roles
    minion: { name: 'Minion', cls: 'role', match: 'minions?', text: 'Dies to any hit, but takes no damage on a miss, even from "half damage on a miss" powers.' },
    soldier: { name: 'Soldier', cls: 'role', match: 'soldier', text: 'Tough, hard to hit, and good at pinning heroes in place.' },
    brute: { name: 'Brute', cls: 'role', match: 'brute', text: 'Lots of HP and big hits, but easy to hit.' },
    skirmisher: { name: 'Skirmisher', cls: 'role', match: 'skirmisher', text: 'Mobile. Hunts for flanks and isolated heroes.' },
    artillery: { name: 'Artillery', cls: 'role', match: 'artillery', text: 'Fragile ranged attacker that keeps its distance. Close in on it.' },
    lurker: { name: 'Lurker', cls: 'role', match: 'lurker', text: 'Waits for an opening, then strikes hard.' },
    controller: { name: 'Controller', cls: 'role', match: 'controller', text: 'Debuffs, slows and repositions heroes.' },
    elite: { name: 'Elite', cls: 'role', match: 'elite', text: 'Worth two normal monsters: more HP and more dangerous powers.' },
    solo: { name: 'Solo', cls: 'role', match: 'solo', text: 'A boss built to fight the whole party alone. Takes two turns every round.' },
    large: { name: 'Large', cls: 'role', match: 'large', text: 'Fills seven hexes, so more heroes can reach it at once, and flanking it only needs an ally somewhere on the far side.' },
    // terrain
    difficult: { name: 'Difficult terrain', cls: 'terrain', match: 'difficult(?: terrain)?', text: 'Costs 2 movement to enter each hex, so a 1-hex shift can\'t enter it.' },
    hazard: { name: 'Hazard', cls: 'bad', match: 'hazards?', text: 'Hurts or hinders anyone who enters it, or starts a turn in it. Forced movement can shove enemies in.' },
    blocks: { name: 'Blocking terrain', cls: 'terrain', match: 'blocks movement', text: 'Can\'t be entered. If it also blocks line of sight, it stops ranged and area attacks that would pass through it.' },
    los: { name: 'Line of sight', cls: 'terrain', match: 'line of sight', text: 'Ranged and area attacks need a clear line to the target. Trees, rocks, walls and pillars block it.' },
  };
  // condition code (engine) → keyword id
  const COND = { prone: 'prone', dazed: 'dazed', stunned: 'stunned', asleep: 'asleep', slowed: 'slowed', immobilized: 'immobilized', weakened: 'weakened', blinded: 'blinded', marked: 'marked', ongoing: 'ongoing', cagrant: 'exposed', vuln: 'vulnerable', hidden: 'hidden', quarry: 'quarry', dying: 'dying' };

  const ids = Object.keys(KW);
  const rx = {};
  for (const id of ids) rx[id] = new RegExp('\\b(?:' + KW[id].match + ')\\b', 'i');
  // one combined pattern for highlighting; longer phrases first so "close burst 2" wins over "burst"
  const all = new RegExp('\\b(' + ids.map(id => KW[id].match).sort((a, b) => b.length - a.length).join('|') + ')\\b', 'gi');
  const idOf = (word) => ids.find(id => new RegExp('^(?:' + KW[id].match + ')$', 'i').test(word));

  // keyword ids mentioned in plain text, in order of first appearance
  function find(text, skip) {
    const out = [];
    const s = String(text || '');
    const hits = ids.map(id => { const m = rx[id].exec(s); return m ? [m.index, id] : null; }).filter(Boolean).sort((a, b) => a[0] - b[0]);
    for (const [, id] of hits) if (!out.includes(id) && !(skip && skip.includes(id))) out.push(id);
    return out;
  }
  // add keywords that the given keywords' own text mentions (one level of nesting is plenty)
  function expand(list, max = 5) {
    const out = list.slice();
    for (const id of list) for (const k of find(KW[id].text)) if (!out.includes(k)) out.push(k);
    return out.slice(0, max);
  }
  // escape plain text and underline the keywords in it
  function mark(text) {
    return esc(text).replace(all, (w) => { const id = idOf(w); return id ? `<u class="kw kw-${KW[id].cls}">${w}</u>` : w; });
  }
  function box(id) {
    const k = KW[id]; if (!k) return '';
    return `<div class="kwbox kw-${k.cls}"><b>${k.icon ? `<span class="kwi">${k.icon}</span>` : ''}${esc(k.name)}</b><p>${mark(k.text)}</p></div>`;
  }
  function boxes(list) { return list.map(box).join(''); }

  // Place the popup column beside an anchor rect, on whichever side has room.
  // side: 'left' | 'right' (preferred). The column is a fixed-position element on <body>.
  let col = null;
  function show(list, rect, side = 'right') {
    if (!col) { col = document.createElement('div'); col.id = 'kwcol'; document.body.appendChild(col); }
    if (!list || !list.length || !rect) { hide(); return; }
    col.innerHTML = boxes(list);
    col.classList.add('on');
    const w = col.offsetWidth, h = col.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let x = side === 'left' ? rect.left - w - 8 : rect.right + 8;
    if (x + w > vw - 4) x = rect.left - w - 8;
    if (x < 4) x = Math.min(vw - w - 4, rect.right + 8);
    let y = Math.min(rect.top, vh - h - 4);
    col.style.left = Math.max(4, x) + 'px'; col.style.top = Math.max(4, y) + 'px';
  }
  function hide() { if (col) { col.classList.remove('on'); col.innerHTML = ''; } }

  G.Keywords = { KW, COND, find, expand, mark, box, boxes, show, hide };
})();
