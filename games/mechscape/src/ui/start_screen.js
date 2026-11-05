// The first screen when the page isn't served by a game server (the copy on
// cariehl.github.io, or npm run offline without ?offline): play alone in the
// browser, or join a game server by its address.
//
// In the top-left corner: Back to the games list and Commentary (only on the
// github.io site, or with ?site for a local preview; Commentary only while
// ../commentary/mechscape.md exists), and a link to the source on GitHub.

import { el } from './screen.js';
import {
  normalizeServer, mixedContentProblem, savedServer, rememberServer, inviteLink, serverInfo,
} from '../client/server_address.js';

export const REPO_URL = 'https://github.com/cariehl/mechscape-threejs';
const ON_SITE = /^https?:$/.test(window.location.protocol)
  && (/(^|\.)github\.io$/.test(window.location.hostname) || /[?&]site\b/.test(window.location.search));
const COMMENTARY_URL = new URL('../commentary/mechscape.md', window.location.href);
const GITHUB_ICON = '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

let commentary = null;
/** The commentary's Markdown, or null when there is none (or this isn't the site). */
function loadCommentary() {
  if (!ON_SITE) return Promise.resolve(null);
  commentary ??= fetch(COMMENTARY_URL, { cache: 'no-cache' })
    .then(async (r) => (r.ok && !(r.headers.get('content-type') || '').includes('text/html') && (await r.text()).trim()) || null)
    .catch(() => null);
  return commentary;
}

function loadMarked() {
  if (window.marked) return Promise.resolve(window.marked);
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'vendor/marked/marked.umd.js';
    script.onload = () => resolve(window.marked || null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** The commentary as HTML: paths made relative to the .md file, and titled images given captions. */
async function renderCommentary(md) {
  const marked = await loadMarked();
  const t = document.createElement('template');
  t.innerHTML = marked ? marked.parse(md, { async: false }) : `<pre>${escapeHtml(md)}</pre>`;
  for (const [selector, attr] of [['img[src]', 'src'], ['a[href]', 'href']]) {
    t.content.querySelectorAll(selector).forEach((node) => {
      const value = node.getAttribute(attr);
      if (!value.startsWith('#')) node.setAttribute(attr, new URL(value, COMMENTARY_URL).href);
    });
  }
  t.content.querySelectorAll('img[title]').forEach((img) => {
    const figure = document.createElement('figure');
    const caption = document.createElement('figcaption');
    caption.textContent = img.getAttribute('title');
    img.removeAttribute('title');
    const parent = img.parentElement;
    (parent && parent.tagName === 'P' && parent.childNodes.length === 1 ? parent : img).replaceWith(figure);
    figure.append(img, caption);
  });
  t.content.querySelectorAll('a[href^="http"]').forEach((a) => {
    a.target = '_blank';
    a.rel = 'noopener';
  });
  return t.innerHTML;
}

function showCommentary(md) {
  const overlay = el('div', 'commentary', '', document.body);
  overlay.innerHTML = '<div class="commentary-box" role="dialog" aria-modal="true" aria-label="Commentary">'
    + '<div class="commentary-body">Loading…</div><div class="commentary-foot"><button type="button">Close</button></div></div>';
  const body = overlay.querySelector('.commentary-body');
  renderCommentary(md).then((html) => { body.innerHTML = html; });
  const close = () => {
    overlay.remove();
    window.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.querySelector('button').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  window.addEventListener('keydown', onKey);
  overlay.querySelector('button').focus();
}

/** The Back / GitHub / Commentary links, top left. */
function siteCorner(parent) {
  const corner = el('div', 'site-corner', '', parent);
  if (ON_SITE) corner.innerHTML = '<a class="site-btn" href="../" title="Back to cariehl.github.io">← Back</a>';
  corner.insertAdjacentHTML('beforeend',
    `<a class="site-btn icon" href="${REPO_URL}" target="_blank" rel="noopener" title="Source code on GitHub" aria-label="GitHub">${GITHUB_ICON}</a>`);
  loadCommentary().then((md) => {
    if (!md) return;
    const button = el('button', 'site-btn', '📝 Commentary', corner);
    button.type = 'button';
    button.onclick = () => showCommentary(md);
  });
  return corner;
}

function describe(info) {
  const parts = [`${info.online} online`];
  if (info.xp_rate && info.xp_rate !== 1) parts.push(`XP ×${info.xp_rate}`);
  return parts.join(' · ');
}

/**
 * Shows the start screen in [status] (the loading screen). Resolves with
 * { mode: 'offline' } or { mode: 'online', server }.
 */
export function showStartScreen(status) {
  return new Promise((resolve) => {
    status.textContent = '';
    const corner = siteCorner(status);
    const panel = el('div', 'start-screen join-form', '', status);
    panel.innerHTML = '<div class="start-title">MechScape</div>'
      + '<div class="muted">Salvage, fight and craft as an android pilot in a ruined scrapyard, then build a mech with your friends.</div>'
      + '<section><h3>Play in your browser</h3>'
      + '<p class="muted small">Single player. The whole game runs in this page and saves in this browser.</p>'
      + '<button type="button" class="primary play-offline">Play in browser</button></section>'
      + '<section><h3>Play on a server</h3><div class="server-slot"></div></section>';
    const finish = (choice) => {
      corner.remove();
      panel.remove();
      resolve(choice);
    };
    panel.querySelector('.play-offline').onclick = () => finish({ mode: 'offline' });
    const slot = panel.querySelector('.server-slot');

    let typed = '';
    const render = () => {
      const server = savedServer();
      slot.textContent = '';
      if (server) {
        slot.innerHTML = '<p class="small">Server: <b class="server-host"></b> <span class="muted server-status">Checking…</span></p>'
          + '<div class="row"><button type="button" class="primary join">Join</button>'
          + '<button type="button" class="change">Change server</button>'
          + '<button type="button" class="invite">Copy invite link</button></div>'
          + '<p class="muted small invite-note"></p>';
        slot.querySelector('.server-host').textContent = new URL(server).host;
        const statusLine = slot.querySelector('.server-status');
        serverInfo(server).then((info) => {
          if (savedServer() !== server) return;
          statusLine.textContent = info ? describe(info) : "Can't reach it right now. Is the server running?";
          statusLine.classList.toggle('warn', !info);
        });
        slot.querySelector('.join').onclick = () => finish({ mode: 'online', server });
        slot.querySelector('.change').onclick = () => {
          typed = server;
          rememberServer(null);
          render();
        };
        slot.querySelector('.invite').onclick = async () => {
          const note = slot.querySelector('.invite-note');
          const link = inviteLink(server);
          try {
            await navigator.clipboard.writeText(link);
            note.textContent = 'Link copied. Anyone who opens it plays on this server.';
          } catch {
            note.textContent = link;
          }
        };
        return;
      }
      slot.innerHTML = '<p class="muted small">Someone hosting a game can send you a link, or type their server\'s address.</p>'
        + '<div class="row"><input class="grow server-input" placeholder="abc-def.trycloudflare.com" spellcheck="false" autocomplete="url">'
        + '<button type="button" class="connect">Connect</button></div><p class="small server-message"></p>';
      const input = slot.querySelector('input');
      const message = slot.querySelector('.server-message');
      input.value = typed;
      const connect = async () => {
        typed = input.value;
        const server = normalizeServer(input.value);
        message.classList.remove('warn');
        if (!server) {
          message.textContent = 'Enter a server address, like https://abc-def.trycloudflare.com';
          return;
        }
        const problem = mixedContentProblem(server);
        if (problem) {
          message.textContent = problem;
          message.classList.add('warn');
          return;
        }
        message.textContent = 'Checking the server…';
        if (!(await serverInfo(server))) {
          message.textContent = `Couldn't reach ${server}. Check the address and that the server is running.`;
          message.classList.add('warn');
          return;
        }
        rememberServer(server);
        render();
      };
      slot.querySelector('.connect').onclick = connect;
      input.onkeydown = (e) => { if (e.key === 'Enter') connect(); };
    };
    render();
  });
}
