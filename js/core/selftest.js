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

  /* ── Image sizing: `![alt|400](url)` ──────────────────────── */

  test('imgSizeFromAlt: reads the size suffix, and only a real one', () => {
    eq(imgSizeFromAlt('Aria|400'),    { alt: 'Aria', w: 400, h: 0 });
    eq(imgSizeFromAlt('Map|600x400'), { alt: 'Map',  w: 600, h: 400 });
    eq(imgSizeFromAlt('Aria | 400 '), { alt: 'Aria', w: 400, h: 0 }, 'spaces around the pipe');
    // A pipe is legal in alt text. Only a pipe followed by digits is a size.
    eq(imgSizeFromAlt('a|b'),         { alt: 'a|b',  w: 0, h: 0 });
    eq(imgSizeFromAlt('a|b|300'),     { alt: 'a|b',  w: 300, h: 0 }, 'the LAST pipe wins');
    eq(imgSizeFromAlt(''),            { alt: '',     w: 0, h: 0 });
    eq(imgSizeFromAlt(null),          { alt: '',     w: 0, h: 0 });
  });

  test('imgSizeFromAlt/imgAltWithSize: round-trip', () => {
    for (const a of ['Aria|400', 'a|b', 'a|b|300', '', 'Map|600x400', 'plain']) {
      const p = imgSizeFromAlt(a);
      eq(imgAltWithSize(p.alt, p.w, p.h), a, `"${a}" must survive a round-trip`);
    }
    eq(imgAltWithSize('x', 0, 0), 'x', 'width 0 removes the suffix — that is "Auto"');
  });

  test('markdown: a sized image gets a width, an unsized one gets none', () => {
    has(renderMarkdown('![Aria|400](https://x/a.png)'), 'style="width:400px;height:auto"');
    has(renderMarkdown('![Aria|400](https://x/a.png)'), 'alt="Aria"', 'the size is not left in the alt');
    has(renderMarkdown('![Map|600x400](https://x/m.png)'), 'style="width:600px;height:400px"');
    lacks(renderMarkdown('![Aria](https://x/a.png)'), 'style=', 'no size in the source, no style');
  });

  // md-live.js finds the clicked <img> back in the source by this attribute,
  // so it has to spell the href the way the SOURCE does, not the way <img src>
  // ends up after cleaning.
  test('markdown: data-pp-src carries the source href', () => {
    has(renderMarkdown('![a|200](https://x/a.png?p=1&q=2)'), 'data-pp-src="https://x/a.png?p=1&amp;q=2"');
  });

  // marked v15 interpolates the alt into `alt="…"` unescaped, so this rendered
  // a live onerror handler into every reader's page before the renderer was
  // overridden. Worlds are public; the content is someone else's.
  test('markdown: image alt is escaped, not interpolated', () => {
    const html = renderMarkdown('![x" onerror="alert(1)](https://ok.png/a.png)');
    lacks(html, 'onerror="alert(1)"', 'a quote in the alt must not close the attribute');
    has(html, '&quot;');
  });

  test('markdown: an image src cannot carry script', () => {
    has(renderMarkdown('![a](javascript:alert(1))'), 'src=""');
    has(renderMarkdown('![a](data:text/html;base64,PHM+)'), 'src=""', 'only data:image is allowed');
    has(renderMarkdown('![a](data:image/png;base64,iVBOR)'), 'src="data:image/png;base64,iVBOR"');
  });

  // The resize writes into ONE image's alt and must leave every other character
  // of the block alone — including a second copy of the same image.
  test('_mdlImgSpans: locates each image, by href and ordinal', () => {
    const t = 'a ![one|100](u1.png) b ![two](u2.png) c ![three](u1.png)';
    const all = _mdlImgSpans(t);
    eq(all.length, 3);
    eq(all.map(s => s.href), ['u1.png', 'u2.png', 'u1.png']);
    eq(all.map(s => s.alt), ['one|100', 'two', 'three']);
    // Rewriting the second u1.png must not touch the first.
    const s2 = all.filter(s => s.href === 'u1.png')[1];
    eq(t.slice(0, s2.altStart) + 'three|250' + t.slice(s2.altEnd),
       'a ![one|100](u1.png) b ![two](u2.png) c ![three|250](u1.png)');
    // And the full span is what Backspace deletes.
    const s0 = all[0];
    eq(t.slice(0, s0.start) + t.slice(s0.end),
       'a  b ![two](u2.png) c ![three](u1.png)');
  });

  test('_mdlImgSpans: a link is not an image', () => {
    eq(_mdlImgSpans('[text](u.png) and ![img](v.png)').map(s => s.href), ['v.png']);
    eq(_mdlImgSpans('![a](<u v.png> "Cap")')[0].href, 'u v.png', 'angle-bracketed href, with a title');
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

  /* ── Unsaved-draft guard ──────────────────────────────────── */

  // registerDraft/draftIsDirty/confirmLeaveDraft are top-level bindings in
  // js/core/data.js, which classic scripts share, so they are reachable here.
  // Each case restores whatever guard was installed before it ran.
  test('draft guard: null and false predicates are clean', () => {
    const prev = _draftCheck;
    try {
      registerDraft(null);
      ok(!draftIsDirty(), 'no predicate means nothing to lose');
      registerDraft(() => false);
      ok(!draftIsDirty(), 'a false predicate is clean');
      ok(confirmLeaveDraft(), 'leaving a clean view must not prompt');
    } finally { registerDraft(prev); }
  });

  test('draft guard: a throwing predicate can never trap the user', () => {
    const prev = _draftCheck;
    try {
      registerDraft(() => { throw new Error('view was torn down'); });
      ok(!draftIsDirty(), 'a throw must read as clean, not as dirty');
      ok(confirmLeaveDraft(), 'and must not block navigation');
    } finally { registerDraft(prev); }
  });

  test('draft guard: dirty respects the answer', () => {
    const prev = _draftCheck, realConfirm = window.confirm;
    try {
      window.confirm = () => false;
      registerDraft(() => true);
      ok(!confirmLeaveDraft(), 'declining keeps you on the page');
      ok(draftIsDirty(), 'and leaves the guard armed');

      window.confirm = () => true;
      registerDraft(() => true);
      ok(confirmLeaveDraft(), 'accepting lets you leave');
      ok(!draftIsDirty(), 'and disarms the guard so it asks only once');
    } finally { window.confirm = realConfirm; registerDraft(prev); }
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
