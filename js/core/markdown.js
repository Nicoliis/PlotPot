/**
 * Markdown rendering, plus PlotPot's `#display:key#` cross-references.
 *
 * Refs are a real marked inline extension rather than a regex pre-pass over the
 * source string, and that ordering is the whole point: block markers are
 * tokenised first, so a heading can never be swallowed — `# Heading #` used to
 * render as a link instead of a heading — and inline extensions don't run
 * inside code spans or fences, so a `# comment #` in a code block stays code.
 */

function _escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const _REF_EXT = {
  extensions: [{
    name: 'ppRef',
    level: 'inline',
    // Where the next candidate is, so marked doesn't consume past one while
    // scanning a run of plain text. undefined = "none left in this chunk".
    start(src) { const i = src.indexOf('#'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      // The inner text may not begin with whitespace — that single condition is
      // what makes every ATX heading immune, since those always have `# `.
      // Lazy, so `#a# and #b#` pairs up instead of spanning both.
      const m = /^#([^#\s][^#\n]*?)#/.exec(src);
      if (!m) return;
      const colon = m[1].indexOf(':');
      return {
        type: 'ppRef',
        raw: m[0],
        display: (colon >= 0 ? m[1].slice(0, colon) : m[1]).trim(),
        key:     (colon >= 0 ? m[1].slice(colon + 1) : m[1]).trim(),
      };
    },
    renderer(t) {
      // The old pre-pass interpolated the display half into an <a> raw, so
      // `#<b>x</b>:key#` rendered as markup. Escaping is the correct behaviour.
      return `<a href="#" class="ref-link" data-ref="${slugify(t.key)}">${_escHtml(t.display)}</a>`;
    },
  }],
};

// Registered on first render so this file still only DECLARES things at load,
// like every other file the loader injects. marked.use() is idempotent per
// extension name here because the flag makes it run exactly once.
let _markedReady = false;
function _ensureMarked() {
  if (_markedReady) return;
  marked.use(_REF_EXT);
  _markedReady = true;
}

function renderMarkdown(text) {
  _ensureMarked();
  return marked.parse(text || '');
}

function bindRefLinks(container) {
  container.querySelectorAll('.ref-link').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      navigateToRef(a.dataset.ref);
    });
  });
}

function navigateToRef(slug) {
  // A group/menu reference (key = slug) navigates to that section directly.
  const group = (State.data?.groups || []).find(g => g.slug === slug);
  if (group) { navigate(group.slug); return; }
  // Otherwise resolve an item by its slugified name.
  for (const g of (State.data?.groups || [])) {
    const idx = (g.items || []).findIndex(item => slugify(item.name) === slug);
    if (idx !== -1) { navigateToItem(g.slug, idx); return; }
  }
  alert('Reference not found: ' + slug);
}
