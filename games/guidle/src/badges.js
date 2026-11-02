// GUIDle badge engine. Shared by the game page and the odds simulator.
(function (root) {
  const HEX = '0123456789abcdef';
  const GROUPS = [[0, 8], [9, 4], [14, 4], [19, 4], [24, 12]]; // [start, length] in the dashed string
  const LEET = { a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f', o: '0', i: '1', l: '1', s: '5', t: '7', g: '9' };
  const WORD_LIST = (
    'ace add bad bed bee cab dab fab fed ice odd oat tea sea bit bot dot cog dog egg fig log gel bag tab lab lid lot oil old sad set sit toe tie ' +
    'cafe face fade bead deed feed food code boss dice taco toad boat coat data soda idea safe best bold cold gold golf goal good file idle side site seed beef lead load cost list slot test stat edit ' +
    'decaf toast basic asset salad oasis coast boost staff ideas cable table bagel ' +
    'coffee office facade decade accede effect access bottle assets cabbage seafood'
  ).split(' ');
  const WORDS = [];
  for (const w of WORD_LIST) {
    let e = '', ok = true;
    for (const ch of w) { if (!(ch in LEET)) { ok = false; break; } e += LEET[ch]; }
    if (ok) WORDS.push({ w, e });
  }

  const rng = (s, l) => Array.from({ length: l }, (_, k) => s + k);

  function analyze(u) {
    u = u.toLowerCase();
    const groups = GROUPS.map(([s, l]) => ({ s, l, str: u.substr(s, l) }));
    const raw = [];
    for (let i = 0; i < u.length; i++) if (u[i] !== '-') raw.push(i);
    const rawStr = raw.map(i => u[i]).join('');
    return { u, groups, raw, rawStr, c: {} };
  }
  const memo = (A, key, fn) => (key in A.c ? A.c[key] : (A.c[key] = fn(A)));

  function findInGroups(A, sub) {
    const out = [];
    for (const g of A.groups) {
      let i = g.str.indexOf(sub);
      while (i >= 0) { out.push(g.s + i); i = g.str.indexOf(sub, i + 1); }
    }
    return out;
  }
  const contains = sub => A => { const p = findInGroups(A, sub); return p.length ? { idx: rng(p[0], sub.length) } : null; };

  // Longest stretch within a group where each neighbour pair satisfies `same(prev, cur)`.
  function longestWithin(A, same) {
    let best = { len: 0, idx: [] };
    for (const g of A.groups) {
      let st = 0;
      for (let i = 1; i <= g.l; i++) {
        if (i === g.l || !same(g.str[i - 1], g.str[i])) {
          const L = i - st;
          if (L > best.len) best = { len: L, idx: rng(g.s + st, L) };
          st = i;
        }
      }
    }
    return best;
  }
  const run = A => memo(A, 'run', A => longestWithin(A, (a, b) => a === b));
  const asc = A => memo(A, 'asc', A => longestWithin(A, (a, b) => HEX.indexOf(b) - HEX.indexOf(a) === 1));
  const desc = A => memo(A, 'desc', A => longestWithin(A, (a, b) => HEX.indexOf(b) - HEX.indexOf(a) === -1));
  const seq = A => { const a = asc(A), d = desc(A); return a.len >= d.len ? a : d; };

  const pal = A => memo(A, 'pal', A => {
    let best = { len: 0, idx: [] };
    for (const g of A.groups) {
      const s = g.str, n = s.length;
      for (let c = 0; c < 2 * n - 1; c++) {
        let l = Math.floor(c / 2), r = l + (c % 2);
        while (l >= 0 && r < n && s[l] === s[r]) { l--; r++; }
        const L = r - l - 1;
        if (L > best.len) best = { len: L, idx: rng(g.s + l + 1, L) };
      }
    }
    return best;
  });

  // Longest run (ignoring dashes) of characters matching a predicate.
  function classRun(A, pred) {
    let best = { len: 0, idx: [] }, st = -1;
    const s = A.rawStr;
    for (let i = 0; i <= s.length; i++) {
      if (i < s.length && pred(s[i])) { if (st < 0) st = i; }
      else if (st >= 0) {
        const L = i - st;
        if (L > best.len) best = { len: L, idx: A.raw.slice(st, i) };
        st = -1;
      }
    }
    return best;
  }
  const isDigit = ch => ch >= '0' && ch <= '9';
  const digitRun = A => memo(A, 'drun', A => classRun(A, isDigit));
  const letterRun = A => memo(A, 'lrun', A => classRun(A, ch => !isDigit(ch)));
  const binRun = A => memo(A, 'brun', A => classRun(A, ch => ch === '0' || ch === '1'));

  const repeatSub = (A, len) => {
    const seen = {};
    for (const g of A.groups) for (let i = 0; i + len <= g.l; i++) {
      const sub = g.str.substr(i, len), pos = g.s + i;
      if (sub in seen && pos - seen[sub] >= len) return { idx: [...rng(seen[sub], len), ...rng(pos, len)] };
      if (!(sub in seen)) seen[sub] = pos;
    }
    return null;
  };

  const words = A => memo(A, 'words', A => {
    const found = [];
    for (const W of WORDS) {
      const p = findInGroups(A, W.e);
      if (p.length) found.push({ w: W.w, e: W.e, idx: rng(p[0], W.e.length) });
    }
    found.sort((a, b) => b.e.length - a.e.length);
    return found;
  });
  const wordTier = (min, max) => A => {
    const f = words(A);
    if (!f.length) return null;
    const L = f[0].e.length;
    if (L < min || L > max) return null;
    return { idx: f[0].idx, detail: f[0].w.toUpperCase() };
  };
  const spells = word => A => {
    const h = words(A).find(x => x.w === word);
    return h ? { idx: h.idx } : null;
  };

  const counts = A => memo(A, 'counts', A => { const c = {}; for (const ch of A.rawStr) c[ch] = (c[ch] || 0) + 1; return c; });
  const letters = A => memo(A, 'letters', A => { let n = 0; for (const ch of A.rawStr) if (!isDigit(ch)) n++; return n; });
  const midGroups = A => A.groups.slice(1, 4);
  const firstGroup = (A, pred) => { for (const g of midGroups(A)) if (pred(g.str)) return { idx: rng(g.s, g.l) }; return null; };
  const allDigits = s => /^[0-9]+$/.test(s);
  const allLetters = s => /^[a-f]+$/.test(s);
  const sorted = s => { for (let i = 1; i < s.length; i++) if (HEX.indexOf(s[i]) < HEX.indexOf(s[i - 1])) return false; return true; };
  const distinct = s => new Set(s).size;
  const isPal = s => s === [...s].reverse().join('');
  const year = String(new Date().getFullYear());

  // ---- Exact probabilities where the math is tractable ----
  // A v4 UUID has 30 free hex characters: position 12 is always '4', position 16 is one of 8, 9, a, b.
  const C = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
  const anyOf = ps => 1 - ps.reduce((a, p) => a * (1 - p), 1);
  const binomTail = (n, p, k) => { let t = 0; for (let i = k; i <= n; i++) t += C(n, i) * p ** i * (1 - p) ** (n - i); return t; };
  const LET = (() => { // distribution of the letter count: 30 free chars (6/16 letters) plus the variant char (2 of 4 are letters)
    const d = new Array(32).fill(0);
    for (let i = 0; i <= 30; i++) { const b = C(30, i) * (6 / 16) ** i * (10 / 16) ** (30 - i); d[i] += b / 2; d[i + 1] += b / 2; }
    return d;
  })();
  const sum = (a, from, to) => a.slice(from, to + 1).reduce((x, y) => x + y, 0);
  const P_SOLID = 1 / 4096, P_TWO = 1680 / 65536; // per four-character group, same for groups 2, 3 and 4
  const P_SORTED8 = C(23, 8) / 16 ** 8;
  const EXACT = {
    bookends: 1 / 16, freshstart: 1 / 256, strongfinish: 1 / 256,
    digifirst: (10 / 16) ** 8, letfirst: (6 / 16) ** 8, phonebook: (10 / 16) ** 12,
    hallmirror: 16 ** -4, sorted8: P_SORTED8, twins: 2 / 65536,
    solid: anyOf([P_SOLID, P_SOLID, P_SOLID]),
    twotone: (1 - P_SOLID) ** 3 - (1 - P_SOLID - P_TWO) ** 3, // some group is two-tone and none is solid (solid outranks it)
    mirror: anyOf([1 / 256, 1 / 256, 1 / 256]),
    numgroup: anyOf([(10 / 16) ** 4, (10 / 16) ** 3, 0.5 * (10 / 16) ** 3]),
    letgroup: anyOf([(6 / 16) ** 4, 0, 0.5 * (6 / 16) ** 3]),
    sorted: anyOf([C(19, 4) / 65536, C(14, 3) / 4096, (C(10, 3) + C(9, 3) + C(8, 3) + C(7, 3)) / 4 / 4096]) * (1 - P_SORTED8),
    sevens: binomTail(30, 1 / 16, 5),
    letterlover: sum(LET, 18, 31), digitdiet: sum(LET, 0, 6),
  };
  // Rough estimates for patterns too rare to simulate well (rounded to 1 / 5 / 10 / 50... million style buckets).
  const EST = {
    six: 9.5 / 16 ** 5, pimaster: 12 / 16 ** 5, decaf: 12 / 16 ** 5,
    coffee: 10 / 16 ** 6, office: 10 / 16 ** 6, seafood: 8 / 16 ** 7,
  };

  const BADGES = [];
  const add = (id, name, desc, test, opt = {}) => BADGES.push({ id, name, desc, test, family: opt.family || id, rank: opt.rank || 0, exact: opt.exact, est: opt.est });

  // Repeated characters
  add('triple', 'Hat Trick', 'Three of the same character in a row.', A => run(A).len === 3 ? run(A) : null, { family: 'run', rank: 1 });
  add('quad', 'Four of a Kind', 'Four of the same character in a row.', A => run(A).len === 4 ? run(A) : null, { family: 'run', rank: 2 });
  add('five', 'High Five', 'Five of the same character in a row.', A => run(A).len === 5 ? run(A) : null, { family: 'run', rank: 3 });
  add('six', 'Broken Record', 'Six or more of the same character in a row.', A => run(A).len >= 6 ? run(A) : null, { family: 'run', rank: 4 });
  // Counting
  add('stepup', 'Step Up', 'Three characters counting up, like 4-5-6.', A => asc(A).len === 3 ? asc(A) : null, { family: 'seq', rank: 1 });
  add('stepdown', 'Count Down', 'Three characters counting down, like c-b-a.', A => desc(A).len === 3 ? desc(A) : null, { family: 'seq', rank: 1 });
  add('stairs', 'Stairway', 'Four characters counting up or down in a row.', A => seq(A).len === 4 ? seq(A) : null, { family: 'seq', rank: 2 });
  add('escalator', 'Escalator', 'Five or more characters counting up or down.', A => seq(A).len >= 5 ? seq(A) : null, { family: 'seq', rank: 3 });
  // Palindromes
  add('racecar', 'Racecar', 'A five- or six-character palindrome inside one group.', A => pal(A).len >= 5 && pal(A).len <= 6 ? pal(A) : null, { family: 'pal', rank: 1 });
  add('reflect', 'Reflection Pool', 'A palindrome seven characters or longer.', A => pal(A).len >= 7 ? pal(A) : null, { family: 'pal', rank: 2 });
  add('mirror', 'Mirror, Mirror', 'A whole four-character group reads the same backwards.', A => firstGroup(A, isPal));
  add('hallmirror', 'Hall of Mirrors', 'The entire first group is a palindrome.', A => isPal(A.groups[0].str) ? { idx: rng(0, 8) } : null);
  // Repeats
  add('dejavu', 'Déjà Vu', 'The same three characters show up twice.', A => repeatSub(A, 3), { family: 'rep', rank: 1 });
  add('echo', 'Echo Chamber', 'The same four characters show up twice.', A => repeatSub(A, 4), { family: 'rep', rank: 2 });
  add('twins', 'Identical Twins', 'Two of the four-character groups match exactly.', A => {
    const m = A.groups.slice(1, 4);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (m[i].str === m[j].str) return { idx: [...rng(m[i].s, 4), ...rng(m[j].s, 4)] };
    return null;
  });
  // Group makeup
  add('numgroup', 'By the Numbers', 'A four-character group made only of digits.', A => firstGroup(A, allDigits));
  add('digifirst', 'Digital Native', 'The whole first group is digits.', A => allDigits(A.groups[0].str) ? { idx: rng(0, 8) } : null);
  add('phonebook', 'Phone Book', 'The last twelve characters are all digits.', A => allDigits(A.groups[4].str) ? { idx: rng(24, 12) } : null);
  add('letgroup', 'Spelling Bee', 'A four-character group made only of letters.', A => firstGroup(A, allLetters));
  add('letfirst', 'Alphabet Soup', 'The whole first group is letters.', A => allLetters(A.groups[0].str) ? { idx: rng(0, 8) } : null);
  add('sorted', 'Neat Freak', 'A four-character group already in sorted order.', A => firstGroup(A, sorted), { family: 'sort', rank: 1 });
  add('sorted8', 'Filing Cabinet', 'The whole first group is in sorted order.', A => sorted(A.groups[0].str) ? { idx: rng(0, 8) } : null, { family: 'sort', rank: 2 });
  add('twotone', 'Two-Tone', 'A four-character group built from just two characters.', A => firstGroup(A, s => distinct(s) === 2), { family: 'tone', rank: 1 });
  add('solid', 'Solid Block', 'A four-character group that is one character repeated.', A => firstGroup(A, s => distinct(s) === 1), { family: 'tone', rank: 2 });
  // Whole-ID makeup
  add('fullhouse', 'Full House', 'Every hex character from 0 to f appears at least once.', A => Object.keys(counts(A)).length === 16 ? { idx: [] } : null);
  add('picky', 'Picky Eater', 'Six or more hex characters never show up.', A => Object.keys(counts(A)).length <= 10 ? { idx: [] } : null);
  add('letterlover', 'Letter Lover', 'At least 18 of the 32 characters are letters.', A => letters(A) >= 18 ? { idx: A.raw.filter(i => !isDigit(A.u[i])) } : null);
  add('digitdiet', 'Digit Devotee', 'Six or fewer letters in the whole ID.', A => letters(A) <= 6 ? { idx: A.raw.filter(i => isDigit(A.u[i])) } : null);
  add('numcrunch', 'Number Cruncher', 'Ten or more digits in a row (dashes don’t count).', A => digitRun(A).len >= 10 && digitRun(A).len < 14 ? digitRun(A) : null, { family: 'drun', rank: 1 });
  add('spreadsheet', 'Spreadsheet Mode', 'Fourteen or more digits in a row.', A => digitRun(A).len >= 14 ? digitRun(A) : null, { family: 'drun', rank: 2 });
  add('letstreak', 'Letter Streak', 'Six or seven letters in a row.', A => letterRun(A).len >= 6 && letterRun(A).len < 8 ? letterRun(A) : null, { family: 'lrun', rank: 1 });
  add('wordsalad', 'Word Salad', 'Eight or more letters in a row.', A => letterRun(A).len >= 8 ? letterRun(A) : null, { family: 'lrun', rank: 2 });
  add('binary', 'Binary Speaker', 'Five characters in a row using only 0 and 1.', A => binRun(A).len >= 5 ? binRun(A) : null);
  add('sevens', 'Lucky Sevens', 'Five or more 7s anywhere in the ID.', A => (counts(A)['7'] || 0) >= 5 ? { idx: A.raw.filter(i => A.u[i] === '7') } : null);
  add('freshstart', 'Fresh Start', 'Begins with 00.', A => A.u.startsWith('00') ? { idx: [0, 1] } : null);
  add('strongfinish', 'Strong Finish', 'Ends with ff.', A => A.u.endsWith('ff') ? { idx: [34, 35] } : null);
  add('bookends', 'Bookends', 'The first and last characters match.', A => A.u[0] === A.u[35] ? { idx: [0, 35] } : null);
  // Famous numbers
  add('answer', 'Deep Thought', 'Contains 42, the answer to everything.', contains('42'));
  add('ok200', 'All Systems OK', 'Contains 200, the web’s favorite status code.', contains('200'));
  add('notfound', 'Page Not Found', 'Contains 404.', contains('404'));
  add('teapot', 'I’m a Teapot', 'Contains 418, the status code for teapots.', contains('418'));
  add('secret', 'Secret Agent', 'Contains 007.', contains('007'));
  add('pi', 'Slice of Pi', 'Contains 314.', contains('314'), { family: 'pi', rank: 1 });
  add('pimaster', 'Pi Master', 'Contains 31415.', contains('31415'), { family: 'pi', rank: 2});
  add('elite', 'Elite', 'Contains 1337.', contains('1337'));
  add('fib', 'Fibonacci Fan', 'Contains 1123, the start of the Fibonacci sequence.', contains('1123'));
  add('year', 'Calendar Roll', `Contains the current year (${year}).`, contains(year));
  // Words
  add('word3', 'Small Talk', 'Spells a three-letter word. Digits can stand in: 0=O, 1=I/L, 5=S, 7=T, 9=G.', wordTier(3, 3), { family: 'word', rank: 1 });
  add('word4', 'Wordsmith', 'Spells a four-letter word.', wordTier(4, 4), { family: 'word', rank: 2 });
  add('word5', 'Lexicographer', 'Spells a five-letter word.', wordTier(5, 5), { family: 'word', rank: 3 });
  add('word6', 'Hex Poet', 'Spells a word of six letters or more.', wordTier(6, 99), { family: 'word', rank: 4 });
  add('code', 'Code Review', 'Spells C0DE.', spells('code'));
  add('cafe', 'Café Society', 'Spells CAFE.', spells('cafe'));
  add('food', 'Snack Break', 'Spells F00D.', spells('food'));
  add('boss', 'Like a Boss', 'Spells B055.', spells('boss'));
  add('data', 'Data Driven', 'Spells DA7A.', spells('data'));
  add('idea', 'Bright Idea', 'Spells 1DEA.', spells('idea'));
  add('taco', 'Taco Tuesday', 'Spells 7AC0.', spells('taco'));
  add('decaf', 'Decaf Mode', 'Spells DECAF.', spells('decaf'));
  add('coffee', 'Coffee Break', 'Spells C0FFEE.', spells('coffee'));
  add('office', 'Back to the Office', 'Spells 0FF1CE.', spells('office'));
  add('seafood', 'Catch of the Day', 'Spells 5EAF00D.', spells('seafood'));
  // Consolation (awarded only when nothing else hits)
  add('average', 'Perfectly Average', 'No patterns at all. Impressively ordinary.', () => null);

  const BY_ID = Object.fromEntries(BADGES.map(b => [b.id, b]));
  for (const b of BADGES) { if (b.id in EXACT) b.exact = EXACT[b.id]; if (b.id in EST) b.est = EST[b.id]; }
  const TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  // Tier by "1 in N" odds.
  const TIER_MAX_N = { common: 20, uncommon: 200, rare: 2000, epic: 20000, legendary: 1e6, mythic: Infinity };
  const tierFor = p => TIERS.find(t => 1 / p < TIER_MAX_N[t]);
  const twoSig = n => Number(n.toPrecision(2));
  // Nearest (on a log scale) of 1, 5, 10, 50, 100, 500... used for estimated odds.
  const bucket = n => { const k = Math.floor(Math.log10(n)); const c = [1, 5, 10].map(m => m * 10 ** k); return c.reduce((a, b) => Math.abs(Math.log10(b / n)) < Math.abs(Math.log10(a / n)) ? b : a); };

  function applyOdds(odds) {
    for (const b of BADGES) {
      // A badge is worth its odds: a 1-in-4,096 pattern scores 4,100 points.
      const o = odds[b.id]; b.method = o.m;
      b.odds = o.m === 'estimate' ? bucket(1 / o.p) : 1 / o.p;
      b.p = 1 / b.odds; b.tier = tierFor(b.p);
      b.points = Math.max(1, Math.round(o.m === 'estimate' ? b.odds : twoSig(b.odds)));
    }
  }

  function evaluate(u) {
    const A = analyze(u);
    const hits = [];
    for (const b of BADGES) {
      if (b.id === 'average') continue;
      const r = b.test(A);
      if (r) hits.push({ b, idx: r.idx || [], detail: r.detail });
    }
    const best = {};
    for (const h of hits) best[h.b.family] = Math.max(best[h.b.family] ?? -1, h.b.rank);
    let res = hits.filter(h => h.b.rank === best[h.b.family]);
    if (!res.length) res = [{ b: BY_ID.average, idx: [] }];
    return res;
  }

  function scoreOf(res) {
    const base = res.reduce((s, h) => s + (h.b.points || 0), 0);
    return { base, total: base };
  }

  const api = { BADGES, BY_ID, TIERS, TIER_MAX_N, tierFor, bucket, applyOdds, evaluate, scoreOf, analyze };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GUIDLE = api;
})(typeof window !== 'undefined' ? window : globalThis);
