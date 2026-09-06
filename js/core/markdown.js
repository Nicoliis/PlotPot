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

/* ── Image sizing: `![alt|400](url)` ───────────────────────────────
   Markdown has no way to spell "this wide". The pipe suffix is Obsidian's
   spelling and it is the one that survives marked untouched: the size rides in
   the ALT text, so the URL half is never touched and the image still tokenises
   as a plain image — only the renderer below has to know. (The other common
   spelling, `![a](url =400x)`, does not parse in marked v15 at all: it breaks
   the image outright and leaves the literal text on the page.)

   Elsewhere — GitHub, an editor that doesn't know us — a sized image still
   renders; the size just shows up as part of the alt text. That is the price of
   keeping it in the document instead of in a sidecar the export would drop. */

// "Aria|400" → { alt:'Aria', w:400, h:0 }.  A pipe that isn't followed by a
// size is just part of the alt: "a|b" stays "a|b", and "a|b|400" is "a|b" at
// 400px, because the lazy head only gives up as much as the size needs.
function imgSizeFromAlt(alt) {
  const m = /^([\s\S]*?)\s*\|\s*(\d{1,5})(?:\s*[x×]\s*(\d{1,5}))?\s*$/.exec(alt || '');
  return m ? { alt: m[1], w: +m[2], h: m[3] ? +m[3] : 0 }
           : { alt: alt || '', w: 0, h: 0 };
}

// The inverse. w = 0 removes the suffix entirely, which is how "Auto" is
// spelled: no size in the source at all, so the CSS max-width rule takes over.
function imgAltWithSize(alt, w, h) {
  const base = String(alt ?? '');
  if (!w) return base;
  return base + '|' + Math.round(w) + (h ? 'x' + Math.round(h) : '');
}

// marked's own cleanUrl is not reachable from here, and overriding the renderer
// means we stop getting it. Images can't run a `javascript:` src in any current
// browser, but a data: URL can carry markup, so only image data is let through.
function _imgSrc(href) {
  const s = String(href || '').trim();
  if (/^(javascript|vbscript|file):/i.test(s)) return '';
  if (/^data:/i.test(s) && !/^data:image\//i.test(s)) return '';
  return s;
}

/* marked v15 builds `<img … alt="${text}">` WITHOUT escaping text, so
   `![x" onerror="alert(1)](ok.png)` ships a live handler into every reader's
   page — worlds are public and rendered for strangers. Overriding the renderer
   for the size suffix is also the fix for that, so both live here.
   data-pp-src carries the href exactly as the SOURCE spells it: md-live.js
   matches the clicked <img> back to its `![…](…)` span with it, and the two
   must agree even when the URL needs escaping to survive the attribute. */
const _IMG_EXT = {
  renderer: {
    image({ href, title, text }) {
      const { alt, w, h } = imgSizeFromAlt(text);
      let out = `<img src="${_escHtml(_imgSrc(href))}" alt="${_escHtml(alt)}"`;
      if (title) out += ` title="${_escHtml(title)}"`;
      out += ` data-pp-src="${_escHtml(href)}"`;
      if (w) {
        out += ` data-pp-w="${w}"` + (h ? ` data-pp-h="${h}"` : '');
        // Inline, not an attribute: `.preview-only img` sets height:auto, and a
        // width ATTRIBUTE loses to it, so a stylesheet would silently win.
        out += ` style="width:${w}px;height:${h ? h + 'px' : 'auto'}"`;
      }
      return out + '>';
    },
  },
};

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
  marked.use(_IMG_EXT);
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
