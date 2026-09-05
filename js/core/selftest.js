/**
 * ?debug=selftest — assertions over the pure functions that the Phase 0
 * migrations and reference resolution stand on.
 *
 * Why this exists at all: there is no build step, no test runner and no CI, and
 * the commits after this one rewrite ids and edges inside worlds people have
 * already written. Running a migration over user content with no way to check
 * it is the actual risk here — the absence of CI is not. So this is the
 * smallest thing that answers "did that stay correct": one file, plain
 * functions, no framework, no dependency.
 *
 * It renders its report into the PAGE as well as the console, because the
 * device this most needs to run on is a phone, where there is no console to
 * read. Add ?debug=selftest to any URL.
 *
 * Adding a case: SelfTest.test('name', () => { ... }) at load time. Throwing
 * fails the case; returning anything passes. Cases run in registration order
 * and are isolated from each other — one throwing does not stop the rest.
 */
const SelfTest = (() => {
  const cases = [];
  const test = (name, fn) => cases.push({ name, fn });

  /* ── Assertions ───────────────────────────────────────────── */

  function ok(cond, msg) {
    if (!cond) throw new Error(msg || 'expected truthy, got falsy');
  }
  function eq(actual, expected, msg) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${msg || 'mismatch'}\n    expected: ${b}\n    actual:   ${a}`);
  }
  function has(haystack, needle, msg) {
    if (!String(haystack).includes(needle)) {
      throw new Error(`${msg || 'missing substring'}\n    wanted:   ${needle}\n    in:       ${haystack}`);
    }
  }
  function lacks(haystack, needle, msg) {
    if (String(haystack).includes(needle)) {
      throw new Error(`${msg || 'unexpected substring'}\n    unwanted: ${needle}\n    in:       ${haystack}`);
    }
  }

  // Swap the global world state for the duration of fn. State.data and
  // State.currentWorld are plain globals shared with the running app, so a case
  // that forgot to put them back would corrupt the session it is running in —
  // hence the finally.
  function withWorld(data, world, fn) {
    const d = State.data, w = State.currentWorld;
    State.data = data;
    State.currentWorld = world;
    try { return fn(); } finally { State.data = d; State.currentWorld = w; }
  }

  // A world whose owner is definitely not the viewer, so isOwner() is false and
  // the visibility rules actually apply. Signed out, isOwner() is false anyway.
  const NOT_YOU = { id: 'selftest-world', owner_id: '00000000-0000-0000-0000-00000000dead' };

  /* ── slugify ──────────────────────────────────────────────── */

  test('slugify: basic shape', () => {
    eq(slugify('Aria Vale'), 'aria-vale');
    eq(slugify('  Hello,  World!  '), 'hello-world');
    eq(slugify('Already-slugged'), 'already-slugged');
    eq(slugify('***'), '', 'punctuation-only collapses to empty');
  });

  // The property C6 (references by id) depends on: navigateToRef receives
  // slugify(key), so an id must survive slugify unchanged or every id-keyed ref
  // breaks the moment it round-trips.
  test('slugify: ids are fixed points', () => {
    for (let i = 0; i < 500; i++) {
      const id = generateId();
      eq(slugify(id), id, `id ${id} must survive slugify unchanged`);
    }
  });

  /* ── generateId ───────────────────────────────────────────── */

  test('generateId: base36, non-empty, bounded', () => {
    for (let i = 0; i < 500; i++) {
      const id = generateId();
      ok(/^[0-9a-z]+$/.test(id), `id ${JSON.stringify(id)} is not base36`);
      ok(id.length > 0 && id.length <= 8, `id ${JSON.stringify(id)} has length ${id.length}`);
    }
  });

  test('generateId: no collisions across 5000 draws', () => {
    const seen = new Set();
    const dupes = [];
    for (let i = 0; i < 5000; i++) {
      const id = generateId();
      if (seen.has(id)) dupes.push(id);
      seen.add(id);
    }
    eq(dupes, [], 'collisions found');
  });

  /* ── parseTags ────────────────────────────────────────────── */

  test('parseTags: trims, lowercases, dedupes, drops empties', () => {
    eq(parseTags('Magic, magic ,  ,SWORDS '), ['magic', 'swords']);
    eq(parseTags(''), []);
    eq(parseTags(null), []);
  });

  /* ── _escHtml — regression guard for the notifications XSS ── */

  test('_escHtml: escapes the four dangerous characters', () => {
    eq(_escHtml('<img src=x onerror=alert(1)>'),
       '&lt;img src=x onerror=alert(1)&gt;');
    eq(_escHtml('a & b'), 'a &amp; b');
    eq(_escHtml('say "hi"'), 'say &quot;hi&quot;');
    eq(_escHtml(null), '', 'null renders as empty, not "null"');
  });

  /* ── Markdown + the #ref# extension ───────────────────────── */

  test('markdown: #display:key# becomes a ref link', () => {
    const html = renderMarkdown('See #Aria:aria-vale# today.');
    has(html, 'class="ref-link"');
    has(html, 'data-ref="aria-vale"');
    has(html, '>Aria<');
  });

  test('markdown: an ATX heading is never a ref', () => {
    const html = renderMarkdown('# Heading');
    has(html, '<h1');
    lacks(html, 'ref-link', 'a heading must not be swallowed by the ref tokenizer');
  });

  test('markdown: a ref inside a code fence stays code', () => {
    const html = renderMarkdown('```\n#not:a-ref#\n```');
    lacks(html, 'ref-link', 'inline extensions must not fire inside fences');
  });

  test('markdown: ref display text is escaped, not interpolated', () => {
    const html = renderMarkdown('#<b>x</b>:k#');
    lacks(html, '<b>x</b>', 'display half must be escaped');
  });

  /* ── isGroupVisible — the gate C1 added to search ─────────── */

  const tree = () => ({
    home: { content: '' },
    groups: [
      { name: 'Public',      slug: 'public',   type: 'list', items: [] },
      { name: 'Secret',      slug: 'secret',   type: 'list', items: [], isPublic: false },
      { name: 'Hidden Menu', slug: 'hmenu',    type: 'menu', isPublic: false },
      { name: 'Under Menu',  slug: 'under',    type: 'list', items: [], parentId: 'hmenu' },
      { name: 'Legacy',      slug: 'legacy',   type: 'list', items: [] },   // no isPublic field
    ],
  });

  test('isGroupVisible: non-owner sees public, not private', () => {
    withWorld(tree(), NOT_YOU, () => {
      ok(isGroupVisible(getGroup('public')),  'a public group is visible');
      ok(!isGroupVisible(getGroup('secret')), 'isPublic:false must hide');
      ok(isGroupVisible(getGroup('legacy')),  'a missing isPublic means public (back-compat)');
    });
  });

  test('isGroupVisible: privacy is inherited through menus', () => {
    withWorld(tree(), NOT_YOU, () => {
      ok(!isGroupVisible(getGroup('under')),
         'a child of a private menu must be hidden even though it is not itself private');
    });
  });

  test('isGroupVisible: a parent cycle terminates', () => {
    const data = tree();
    // Not reachable through the UI, but a hand-edited import could produce it,
    // and an unguarded walk would hang the tab rather than fail a check.
    data.groups.push({ name: 'A', slug: 'a', type: 'menu', parentId: 'b' });
    data.groups.push({ name: 'B', slug: 'b', type: 'menu', parentId: 'a' });
    withWorld(data, NOT_YOU, () => {
      isGroupVisible(getGroup('a'));   // must return rather than loop
      ok(true, 'cycle walk terminated');
    });
  });

  /* ── timeAgo ──────────────────────────────────────────────── */

  test('timeAgo: buckets', () => {
    const ago = s => timeAgo(new Date(Date.now() - s * 1000).toISOString());
    eq(ago(5), 'just now');
    eq(ago(120), '2m');
    eq(ago(7200), '2h');
    eq(ago(172800), '2d');
    eq(timeAgo(null), '');
  });

  /* ── Runner + on-page report ──────────────────────────────── */

  function run() {
    const results = cases.map(({ name, fn }) => {
      try { fn(); return { name, pass: true }; }
      catch (e) { return { name, pass: false, err: e && e.message ? e.message : String(e) }; }
    });
    const failed = results.filter(r => !r.pass);

    console.group(`SelfTest — ${results.length - failed.length}/${results.length} passed`);
    results.forEach(r => r.pass ? console.log('PASS', r.name)
                                : console.error('FAIL', r.name, '\n' + r.err));
    console.groupEnd();

    _report(results, failed);
    return { total: results.length, failed: failed.length, results };
  }

  // Rendered, not just logged: the device this most needs to run on is a phone,
  // where opening a console is not realistic.
  function _report(results, failed) {
    document.getElementById('selftest-report')?.remove();
    const box = document.createElement('div');
    box.id = 'selftest-report';
    box.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:2147483647', 'overflow:auto',
      'background:#0f1117', 'color:#e0e0ff', 'padding:16px',
      // auth-gate.js hides body until sign-in resolves; opt back in explicitly
      // so selftest is readable signed-out too, exactly as #auth-gate does.
      'visibility:visible',
      'font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
    ].join(';'));

    const head = document.createElement('div');
    head.setAttribute('style', 'display:flex;align-items:center;gap:12px;margin-bottom:14px');
    const title = document.createElement('strong');
    title.textContent = `SelfTest — ${results.length - failed.length}/${results.length} passed`;
    title.style.color = failed.length ? '#ff8c8c' : '#6fe0a0';
    title.style.fontSize = '15px';
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.setAttribute('style',
      'margin-left:auto;background:#334155;color:#fff;border:none;padding:6px 14px;border-radius:8px;cursor:pointer');
    close.onclick = () => box.remove();
    head.append(title, close);
    box.append(head);

    results.forEach(r => {
      const line = document.createElement('div');
      line.style.marginBottom = '6px';
      const tag = document.createElement('span');
      tag.textContent = r.pass ? 'PASS  ' : 'FAIL  ';
      tag.style.color = r.pass ? '#6fe0a0' : '#ff8c8c';
      line.append(tag, document.createTextNode(r.name));
      if (!r.pass) {
        const pre = document.createElement('pre');
        pre.textContent = r.err;                       // textContent: a failure message can quote markup
        pre.setAttribute('style',
          'margin:4px 0 10px 48px;white-space:pre-wrap;color:#ffb4b4;background:#1a1a2e;padding:8px;border-radius:6px');
        line.append(pre);
      }
      box.append(line);
    });

    document.body.appendChild(box);
  }

  function requested() {
    try { return new URLSearchParams(location.search).get('debug') === 'selftest'; }
    catch { return false; }
  }

  return { test, run, requested, ok, eq, has, lacks, withWorld };
})();

window.SelfTest = SelfTest;
