import { COLOR_INFO, KEYWORD_INFO, cardDef, type CardDef } from '../../shared/cards';
import type { Keyword, Unit } from '../../shared/types';

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const KEYWORD_WORDS = ['Arrival', 'Last Breath', 'Freeze', 'Root', 'Barrier', 'Swift', 'Ready', 'Sacrifice', 'Drain', 'Siege', 'Flying', 'Guardian', 'Deadly', 'Regenerate'];

export function richText(text: string) {
  let t = esc(text);
  for (const w of KEYWORD_WORDS) t = t.replace(new RegExp(`\\b(${w})\\b`, 'g'), '<b>$1</b>');
  return t;
}

export function keywordLine(kw: Keyword[]) {
  return kw.map((k) => `<span class="kw" title="${esc(KEYWORD_INFO[k].text)}">${KEYWORD_INFO[k].icon} ${KEYWORD_INFO[k].name}</span>`).join(' ');
}

export interface CardRenderOpts { cost?: number; unit?: Unit; extraClass?: string; iid?: number }

/** Full card face as HTML. If `unit` is given, shows its live stats. */
export function cardHTML(d: CardDef, o: CardRenderOpts = {}) {
  const col = COLOR_INFO[d.color];
  const cost = o.cost ?? d.cost;
  const costCls = cost < d.cost ? 'cheaper' : cost > d.cost ? 'pricier' : '';
  const kw = (o.unit ? o.unit.kw : d.kw) ?? [];
  const isChamp = !!(d.champion || d.levelOf);
  const typeLabel = isChamp ? (d.levelOf ? '★★ Champion' : '★ Champion') : d.type === 'unit' ? 'Unit' : d.type === 'spell' ? 'Spell' : 'Order';
  let stats = '';
  if (d.type === 'unit') {
    const atk = o.unit ? o.unit.atk + o.unit.tempAtk : d.atk!;
    const hp = o.unit ? o.unit.hp : d.hp!;
    const atkCls = atk > d.atk! ? 'up' : atk < d.atk! ? 'down' : '';
    const hpCls = o.unit && hp < o.unit.maxHp ? 'down' : hp > d.hp! ? 'up' : '';
    const speed = d.speed ?? 2, range = d.range ?? 1;
    stats = `<div class="stats">
      <span class="atk ${atkCls}">${atk}</span>
      <span class="mini">${speed !== 2 ? `<i title="Speed">👣${speed}</i>` : ''}${range > 1 ? `<i title="Range">🎯${range}</i>` : ''}</span>
      <span class="hp ${hpCls}">${hp}</span></div>`;
  }
  return `<div class="card ${d.color} ${d.type} ${isChamp ? 'champion' : ''} ${o.extraClass ?? ''}" style="--col:${col.hex}" ${o.iid !== undefined ? `data-iid="${o.iid}"` : ''}>
    <div class="cost ${costCls}">${cost}</div>
    <div class="art"><span>${d.icon}</span></div>
    <div class="name">${esc(d.name)}</div>
    <div class="type">${typeLabel} · ${col.name}${d.token && !d.levelOf ? ' · Token' : ''}</div>
    <div class="text">${kw.length ? `<div class="kws">${keywordLine(kw)}</div>` : ''}${richText(d.text)}${!d.text && !kw.length && d.flavor ? `<i class="flavor">${esc(d.flavor)}</i>` : ''}</div>
    ${stats}
  </div>`;
}

export function cardBackHTML() {
  return `<div class="card back"><div class="back-orb"></div></div>`;
}

export function keywordHelp(kw: Keyword[]) {
  return kw.map((k) => `<div class="kwhelp"><b>${KEYWORD_INFO[k].icon} ${KEYWORD_INFO[k].name}</b> ${esc(KEYWORD_INFO[k].text)}</div>`).join('');
}

export function unitCardHTML(u: Unit) {
  return cardHTML(cardDef(u.cardId), { unit: u });
}
