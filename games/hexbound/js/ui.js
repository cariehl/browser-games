// Shared bits for the menu screens: the top bar, hex portraits, meters and the act track.
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CLASS_ICON = { fighter: '⛨', rogue: '🗡', ranger: '➶', cleric: '✚', warlord: '⚑', wizard: '✦' };

  // A hex portrait tinted by class colour (the same shape as the battle dock and result crests).
  // opts: { size: 'sm' | 'md' | 'lg', badge: text in the bottom tab, dead: true }
  function hexpor(cls, opts = {}) {
    return `<span class="hexpor ${opts.size || 'md'} cls-${cls} ${opts.dead ? 'dead' : ''}" aria-hidden="true"><span>${opts.dead ? '☠' : CLASS_ICON[cls] || '●'}</span>${opts.badge != null ? `<em>${esc(opts.badge)}</em>` : ''}</span>`;
  }
  // A neutral hex crest with any glyph in it.
  const crest = (icon, cls = '') => `<span class="crest ${cls}" aria-hidden="true">${icon}</span>`;

  // The bar across the top of every menu screen.
  // opts: { backId, backAct, backLabel, eyebrow, title, mid, right }
  function topbar(o) {
    const back = `<button class="btn ghost tb-back" ${o.backId ? `id="${o.backId}"` : ''} ${o.backAct ? `data-act="${o.backAct}"` : ''} title="Back to the main menu"><span aria-hidden="true">←</span> ${esc(o.backLabel || 'Menu')}</button>`;
    return `<header class="pb-head topbar">${back}
      <div class="tb-title">${o.eyebrow ? `<small>${o.eyebrow}</small>` : ''}<h2>${o.title}</h2></div>
      ${o.mid ? `<div class="tb-mid">${o.mid}</div>` : ''}
      <div class="pb-head-r">${o.right || ''}</div></header>`;
  }

  // A labelled meter: value out of max, with an optional class for colour.
  const meter = (val, max, cls = '', label = '') => {
    const pct = max ? Math.max(0, Math.min(100, Math.round(val / max * 100))) : 0;
    return `<span class="meter ${cls}" role="meter" aria-valuenow="${val}" aria-valuemax="${max}"><i style="width:${pct}%"></i>${label ? `<span>${label}</span>` : ''}</span>`;
  };

  // Pips for small counts (surges, points): filled up to n of max.
  const pips = (n, max, cls = '') => `<span class="pips ${cls}" aria-label="${n} of ${max}">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;

  G.Menu = { esc, hexpor, crest, topbar, meter, pips, CLASS_ICON };
})();
