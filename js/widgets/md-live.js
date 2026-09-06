/**
 * Live-preview markdown editor — view and edit at the same time.
 *
 * The markdown source is the only truth. Blocks you aren't in render as HTML;
 * the block your caret is in shows its raw markers while ALREADY being styled,
 * so typing `#` makes the line a heading immediately and deleting it reverts.
 *
 * Two ideas carry the whole design:
 *
 *  1. A block's element is only rebuilt when its TYPE changes — one keystroke
 *     in a hundred. Plain typing touches no DOM structure at all, so the caret
 *     never moves and there is nothing to restore.
 *  2. The active block holds a REAL h1-h6 / blockquote / pre, whose text is the
 *     raw markdown. So `.preview-only`'s existing stylesheet styles the block
 *     identically whether it's rendered or being edited — one heading scale,
 *     no parallel rules to drift.
 *
 * Invariants worth keeping:
 *  INV-1  an active block's text lives in exactly one element under .mdl-block
 *  INV-2  inst.md is current after every input event, so onChange and the
 *         Save button never see a stale string
 *
 * Deliberately NOT used: document.execCommand (deprecated, differs per
 * browser) and document.selectionchange (document-scoped, so it would fire for
 * every editor on a page of N expanded sections and need real teardown).
 * Every listener here lives inside the widget's own subtree and dies with it
 * when renderCurrentView() wipes #main-content.
 */

/* ── Block model ───────────────────────────────────────────────────
   The BLOCKS own the structure, not the lexer. Each block holds its text with
   no trailing blank lines, and the document is those texts joined by exactly
   one blank line:
     md === blocks.map(b => b.text).join('\n\n')
   The lexer is used only to split a string we're handed (load, paste, undo,
   setMarkdown); after that, structural edits manipulate this array.
   Two bugs died with that decision: markdown has no way to spell an EMPTY
   paragraph, so re-deriving from the lexer silently swallowed the block Enter
   had just made; and re-splicing raw token text let blank lines pile up into
   \n\n\n\n. Canonical separators mean neither can happen. */

// marked's lexer normalises CRLF itself, so we must too, or our offsets stop
// agreeing with the text it hands back.
function _mdlNorm(s) { return String(s ?? '').replace(/\r\n|\r/g, '\n'); }

const _MDL_SEP = '\n\n';

function _mdlText(b) { return b.text; }

// Where a block's text starts in the joined document.
function _mdlStart(inst, i) {
  let n = 0;
  for (let j = 0; j < i; j++) n += inst.blocks[j].text.length + _MDL_SEP.length;
  return n;
}

function _mdlJoin(inst) { return inst.blocks.map(b => b.text).join(_MDL_SEP); }

// Split a markdown string into block texts. Trailing blank lines are dropped
// per block because the separator is canonical.
function _mdlSplitTexts(md) {
  const out = [];
  marked.lexer(_mdlNorm(md)).forEach(t => {
    if (t.type === 'space') return;                 // separators are implicit now
    const text = t.raw.replace(/\n+$/, '');
    if (text !== '') out.push(text);
  });
  return out.length ? out : [''];
}

/* ── Live classification ───────────────────────────────────────────
   Runs on every keystroke, so it must be cheap — and it must AGREE with what
   marked will do when the block renders, or you get "styled while typing,
   different once I click away". When in doubt be conservative: a lone `#` is
   not a heading until the space lands, because that is marked's answer too. */
function _mdlClassify(text) {
  const nl = text.indexOf('\n');
  const first = nl === -1 ? text : text.slice(0, nl);
  let m;
  if (/^ {0,3}(```|~~~)/.test(first))                            return { block: 'code' };
  if ((m = /^ {0,3}(#{1,6})(\s|$)/.exec(first)))                 return { block: 'heading', level: m[1].length };
  if (/^ {0,3}>/.test(first))                                    return { block: 'quote' };
  if (/^ {0,3}([-*+]|\d{1,9}[.)])\s/.test(first))                return { block: 'list' };
  if (/^ {0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(first)) return { block: 'hr' };
  return { block: 'para' };
}

// The tag the active block wears. A real heading/quote/pre means the existing
// .preview-only rules style the raw text exactly as they style the rendered
// version — that parity is the point.
function _mdlTag(k) {
  return k.block === 'heading' ? 'h' + k.level
       : k.block === 'quote'   ? 'blockquote'
       : k.block === 'code'    ? 'pre'
       : k.block === 'list'    ? 'div'
       : 'p';
}

function _mdlKey(k) { return k.block + (k.level || ''); }

// Length of the block marker on a line ('## ', '> ', '- ', '1. ').
function _mdlMarkerLen(line) {
  const m = /^ {0,3}(#{1,6} +|> ?|[-*+] +|\d{1,9}[.)] +)/.exec(line);
  return m ? m[0].length : 0;
}

/* ── Caret ─────────────────────────────────────────────────────────
   Two currencies: an offset within one block (for live restyling) and an
   absolute offset into inst.md (for every structural edit). */

// Caret offset within `el`, measured by how much text precedes it.
function _mdlOffsetIn(el, node, offset) {
  const pre = document.createRange();
  pre.selectNodeContents(el);
  try { pre.setEnd(node, offset); } catch { return 0; }
  return pre.toString().length;
}

function _mdlPlace(node, offset) {
  const r = document.createRange();
  const max = node.nodeType === 3 ? node.length : node.childNodes.length;
  r.setStart(node, Math.max(0, Math.min(offset, max)));
  r.collapse(true);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

function _mdlSetOffsetIn(el, off) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n = 0, t;
  while ((t = w.nextNode())) {
    if (n + t.length >= off) return _mdlPlace(t, off - n);
    n += t.length;
  }
  _mdlPlace(el, el.childNodes.length);   // empty block: caret in the element
}

// Offset in the RENDERED text of a block -> offset in its source. Corrects for
// the block markers the rendered version hides ('## ', '> ', '- ', '1. ').
// Inline marks are not corrected, so a click inside **bold** can be a couple of
// characters out — unavoidable without an offset map, and invisible in practice
// because activating the block reveals every marker and reflows the line.
function _mdlSrcFromViz(text, viz) {
  const lines = text.split('\n');
  let vi = 0, si = 0;
  for (const line of lines) {
    const pre = _mdlMarkerLen(line);
    const body = line.length - pre;
    if (viz <= vi + body) return si + pre + (viz - vi);
    vi += body + 1;                 // the newline is one visible char either way
    si += line.length + 1;
  }
  return text.length;
}

// The standard API is caretPositionFromPoint; caretRangeFromPoint is the older
// WebKit/Blink spelling. This is the only browser fork in the file.
function _mdlCaretFromPoint(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r && { node: r.startContainer, offset: r.startOffset };
}

/* ── Instance ──────────────────────────────────────────────────── */

function _mdlBlockIndexAt(inst, abs) {
  for (let i = inst.blocks.length - 1; i >= 0; i--) if (abs >= _mdlStart(inst, i)) return i;
  return 0;
}

function _mdlBlockElOf(inst, node) {
  let n = node;
  while (n && n !== inst.root) {
    if (n.classList?.contains('mdl-block')) return n;
    n = n.parentNode;
  }
  return null;
}

// Never let an edit run with the caret on the root instead of inside a block:
// the typed text would become a direct child of the root, where nothing commits
// it, and it would vanish at the next render — silently losing the user's
// words. Snap the caret into a real block first.
function _mdlEnsureInBlock(inst) {
  const s = window.getSelection();
  if (!s || !s.rangeCount) return;
  const r = s.getRangeAt(0);
  if (!inst.root.contains(r.startContainer)) return;
  if (_mdlBlockElOf(inst, r.startContainer)) return;
  const i = Math.max(0, Math.min(inst.blocks.length - 1, r.startOffset - 1));
  _mdlActivate(inst, i);
  _mdlSetOffsetIn(inst.blocks[i].el, inst.blocks[i].text.length);
  _mdlReadSel(inst);
}

// Belt and braces for anything that slips past that guard: fold a stray node
// under the root into a real block rather than dropping it on the floor.
function _mdlHealRoot(inst) {
  const strays = [...inst.root.childNodes].filter(n => !(n.nodeType === 1 && n.classList?.contains('mdl-block')));
  if (!strays.length) return false;
  const i = inst.active >= 0 ? inst.active : 0;
  const add = strays.map(n => n.textContent || '').join('');
  strays.forEach(n => n.remove());
  const b = inst.blocks[i];
  if (b && add) {
    b.text += add;
    if (i === inst.active) _mdlMountActive(inst, b); else _mdlRenderInactive(inst, b);
    _mdlSetOffsetIn(b.el, b.text.length);
  }
  inst.md = _mdlJoin(inst);
  return true;
}

// Read the live selection back into inst.sel as absolute source offsets. Cached
// rather than read on demand so a toolbar button stealing focus can't lose it.
function _mdlReadSel(inst) {
  const s = window.getSelection();
  if (!s || !s.rangeCount) return;
  const r = s.getRangeAt(0);
  if (!inst.root.contains(r.startContainer)) return;
  const el = _mdlBlockElOf(inst, r.startContainer);
  if (!el) return;
  const i = [...inst.root.children].indexOf(el);
  const b = inst.blocks[i];
  if (!b) return;
  const a = _mdlStart(inst, i) + _mdlOffsetIn(el, r.startContainer, r.startOffset);
  let end = a;
  if (!r.collapsed) {
    const el2 = _mdlBlockElOf(inst, r.endContainer);
    const j = [...inst.root.children].indexOf(el2);
    const b2 = inst.blocks[j];
    if (b2) end = _mdlStart(inst, j) + _mdlOffsetIn(el2, r.endContainer, r.endOffset);
  }
  inst.sel = { a: Math.min(a, end), b: Math.max(a, end) };
}

/* ── Rendering ─────────────────────────────────────────────────── */

// Inactive: rendered markdown, refs styled but inert. Rendering per block with
// renderMarkdown (not marked.parser on a token) keeps this correct even when
// the block's text has just changed type.
function _mdlRenderInactive(inst, b) {
  // trim(): marked ends its output with a newline, which would otherwise sit in
  // the block as a stray text node.
  b.el.innerHTML = renderMarkdown(_mdlText(b)).trim();
  b.el.removeAttribute('data-mdl-active');
  const k = _mdlClassify(_mdlText(b));
  b.el.dataset.mdlBlock = k.block;
  if (k.level) b.el.dataset.mdlLevel = k.level; else delete b.el.dataset.mdlLevel;
}

// Active: the raw source, inside the tag its markers imply.
function _mdlMountActive(inst, b) {
  const text = _mdlText(b);
  const k = _mdlClassify(text);
  const tag = document.createElement(_mdlTag(k));
  tag.textContent = text;
  b.el.innerHTML = '';
  b.el.appendChild(tag);
  b.el.dataset.mdlActive = '1';
  b.el.dataset.mdlBlock = k.block;
  if (k.level) b.el.dataset.mdlLevel = k.level; else delete b.el.dataset.mdlLevel;
  b.el.dataset.mdlKey = _mdlKey(k);
}

// Give every block a fresh element. The caret is restored afterwards from an
// absolute offset, so throwing the DOM away is safe.
function _mdlPaint(inst) {
  _mdlDropImgSel(inst);        // these block elements are about to be discarded
  inst.active = -1;
  inst.root.innerHTML = '';
  inst.blocks.forEach(b => {
    b.el = document.createElement('div');
    b.el.className = 'mdl-block';
    inst.root.appendChild(b.el);
    _mdlRenderInactive(inst, b);
  });
}

// Replace the document wholesale from a markdown string.
function _mdlBuild(inst) {
  inst.blocks = _mdlSplitTexts(inst.md).map(text => ({ text, el: null }));
  inst.md = _mdlJoin(inst);
  _mdlPaint(inst);
}

function _mdlDeactivate(inst) {
  const b = inst.blocks[inst.active];
  if (!b) { inst.active = -1; return; }
  _mdlCommit(inst);
  _mdlRenderInactive(inst, b);
  inst.active = -1;
}

function _mdlActivate(inst, i) {
  // A block being edited shows raw text, so there is no image to stay selected
  // on — and the active block must never be the one wearing an overlay.
  _mdlDropImgSel(inst);
  if (inst.active === i) return;
  if (inst.active !== -1) _mdlDeactivate(inst);
  const b = inst.blocks[i];
  if (!b) return;
  _mdlMountActive(inst, b);
  inst.active = i;
}

// Read the active block's DOM text back into the model. Cheap, and running it
// on every input is what makes INV-2 hold — including after a native edit we
// didn't originate.
function _mdlCommit(inst) {
  const b = inst.blocks[inst.active];
  if (!b) return;
  const text = b.el.textContent;
  if (text === b.text) return;
  b.text = text;
  inst.md = _mdlJoin(inst);
}

/* ── Structural edits ──────────────────────────────────────────────
   Two paths, and the distinction matters:

   _mdlApply   takes a whole markdown STRING and re-splits it. Right for paste,
               undo and setMarkdown, where the structure comes from the text.
   _mdlSetTexts takes an explicit ARRAY of block texts. Right for Enter,
               Backspace and Delete, because markdown cannot spell an empty
               paragraph — re-splitting a string would silently swallow the very
               block Enter just created. */

function _mdlApply(inst, md, caret) {
  _mdlSetTexts(inst, _mdlSplitTexts(md), caret);
}

function _mdlSetTexts(inst, texts, caret) {
  _mdlPush(inst);                       // snapshot the state we're leaving
  inst.blocks = texts.map(text => ({ text, el: null }));
  inst.md = _mdlJoin(inst);
  _mdlPaint(inst);
  _mdlRestore(inst, caret);
  inst.fire();
  _mdlPush(inst);
}

function _mdlTexts(inst) { return inst.blocks.map(b => b.text); }

function _mdlRestore(inst, abs) {
  const at = Math.max(0, Math.min(abs, inst.md.length));
  const i = _mdlBlockIndexAt(inst, at);
  _mdlActivate(inst, i);
  const b = inst.blocks[i];
  _mdlSetOffsetIn(b.el, Math.min(at - _mdlStart(inst, i), b.text.length));
  inst.sel = { a: at, b: at };
}

function _mdlEnter(inst, soft) {
  const i = _mdlBlockIndexAt(inst, inst.sel.a);
  const start = _mdlStart(inst, i);
  const texts = _mdlTexts(inst);
  const text = texts[i];
  const from = inst.sel.a - start;
  const to   = Math.max(from, inst.sel.b - start);

  // A soft break, and Enter inside a fence, stay INSIDE the block: a code block
  // is legitimately multi-line and must not be split in two.
  if (soft || _mdlClassify(text).block === 'code') {
    const ins = soft ? '  \n' : '\n';
    texts[i] = text.slice(0, from) + ins + text.slice(to);
    return _mdlSetTexts(inst, texts, start + from + ins.length);
  }

  // Continue a list; on an item that is only a marker, leave the list instead.
  const ls = text.lastIndexOf('\n', from - 1) + 1;
  const lm = /^(\s*)([-*+]|(\d{1,9})[.)])(\s+)(.*)$/.exec(text.slice(ls, from));
  if (lm) {
    if (!lm[5].trim()) {                                  // "- " with nothing after it
      texts[i] = text.slice(0, ls) + text.slice(to);
      return _mdlSetTexts(inst, texts, start + ls);
    }
    const marker = lm[3] ? (Number(lm[3]) + 1) + '. ' : lm[2] + lm[4];
    const ins = '\n' + lm[1] + marker;
    texts[i] = text.slice(0, from) + ins + text.slice(to);
    return _mdlSetTexts(inst, texts, start + from + ins.length);
  }

  // Otherwise split into two blocks. The tail may legitimately be empty — that
  // is the new paragraph you just asked for, and it only exists because the
  // block array, not the lexer, owns the structure here.
  texts.splice(i, 1, text.slice(0, from), text.slice(to));
  return _mdlSetTexts(inst, texts, start + from + _MDL_SEP.length);
}

function _mdlBackspaceEdge(inst) {
  const i = _mdlBlockIndexAt(inst, inst.sel.a);
  const texts = _mdlTexts(inst);
  const start = _mdlStart(inst, i);

  // A marker under the caret demotes to a paragraph first. Highest-value single
  // behaviour in a live editor: Backspace on "## " gives prose, not a merge.
  const mk = _mdlMarkerLen(texts[i]);
  if (mk) {
    texts[i] = texts[i].slice(mk);
    return _mdlSetTexts(inst, texts, start);
  }

  if (i === 0) return;                                   // nothing to merge into
  const join = _mdlStart(inst, i - 1) + texts[i - 1].length;
  texts.splice(i - 1, 2, texts[i - 1] + texts[i]);
  _mdlSetTexts(inst, texts, join);
}

function _mdlDeleteEdge(inst) {
  const i = _mdlBlockIndexAt(inst, inst.sel.a);
  const texts = _mdlTexts(inst);
  if (i + 1 >= texts.length) return;
  const join = _mdlStart(inst, i) + texts[i].length;
  // Strip the next block's marker, or merging gives "para## Heading".
  const mk = _mdlMarkerLen(texts[i + 1]);
  texts.splice(i, 2, texts[i] + texts[i + 1].slice(mk));
  _mdlSetTexts(inst, texts, join);
}

function _mdlInsertText(inst, str) {
  const { a, b } = inst.sel;
  const t = _mdlNorm(str);
  _mdlApply(inst, inst.md.slice(0, a) + t + inst.md.slice(b), a + t.length);
}

/* ── Undo ──────────────────────────────────────────────────────────
   Fully our own. Native undo is tracked per editing host and every caret move
   between blocks rewrites two siblings' innerHTML, which leaves the browser's
   entries pointing at removed nodes — Ctrl+Z then misfires differently per
   browser. Snapshotting the whole string is viable because these are item
   bodies, a few KB at most. stack[i] is always "the document as it is now",
   so undo is just i--. */
function _mdlHist() { return { stack: [], i: -1, timer: null }; }

function _mdlPush(inst) {
  const h = inst.hist;
  clearTimeout(h.timer); h.timer = null;
  const top = h.stack[h.i];
  if (top && top.md === inst.md) { top.a = inst.sel.a; top.b = inst.sel.b; return; }
  h.stack.splice(h.i + 1);                 // a fresh edit truncates the redo tail
  h.stack.push({ md: inst.md, a: inst.sel.a, b: inst.sel.b });
  if (h.stack.length > 200) h.stack.shift();
  h.i = h.stack.length - 1;
}

// Typing coalesces: the timer restarts each keystroke, so one snapshot lands
// per pause rather than one per character.
function _mdlTouch(inst) {
  clearTimeout(inst.hist.timer);
  inst.hist.timer = setTimeout(() => { if (inst.root.isConnected) _mdlPush(inst); }, 500);
}

function _mdlStep(inst, dir) {
  if (inst.hist.timer) _mdlPush(inst);     // flush pending typing first
  const h = inst.hist;
  const j = h.i + dir;
  if (j < 0 || j >= h.stack.length) return;
  h.i = j;
  const e = h.stack[j];
  inst.md = e.md;
  _mdlBuild(inst);
  _mdlRestore(inst, e.a);
  inst.fire();
}

/* ── Image sizing ──────────────────────────────────────────────────
   Editing `![alt|400](url)` as text means losing sight of the thing you are
   sizing, which is the one job a live editor has. So an image here is a real
   object: click it and you get a frame, a corner grip, and a bar that says how
   wide it is.

   The whole feature is a projection. The SOURCE is still the only truth — a
   resize rewrites the alt suffix of one `![…](…)` span and nothing else, so
   Ctrl+Z, the Save button, the markdown export and a reader's rendered page all
   see it the same way. Nothing is stored about "the selected image" beyond
   where to write next.

   Two invariants keep it from fighting the editor:
     • the selected image's block is never the ACTIVE block. An active block
       shows raw text and has no <img> in it at all, so the two states are
       mutually exclusive by construction, and the selection is dropped by
       _mdlPaint and _mdlActivate rather than by remembering to.
     • every overlay node is contenteditable="false" and lives inside the
       block, which is already position:relative. Inactive blocks are never read
       back into the model (_mdlCommit only touches the active one), so the
       chrome cannot leak into the document's text. */

const _MDL_IMG_MIN_W = 40;
const _MDL_IMG_BAR_H = 38;      // mirrors .mdl-img-bar's height in components.css

// Every `![alt](href)` in a block's source, with the offsets of its alt text —
// the only part a resize rewrites. Matching by href AND ordinal is what lets a
// block hold several images, including several copies of the same one.
const _MDL_IMG_RE = /!\[([^\]]*)\]\(\s*(<[^>]*>|[^\s)]*)(?:\s+("[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

function _mdlImgSpans(text) {
  const out = [];
  _MDL_IMG_RE.lastIndex = 0;
  let m;
  while ((m = _MDL_IMG_RE.exec(text))) {
    let href = m[2] || '';
    if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1);
    out.push({
      href,
      alt: m[1],
      start: m.index,
      end: m.index + m[0].length,
      altStart: m.index + 2,                    // just past '!['
      altEnd: m.index + 2 + m[1].length,
    });
  }
  return out;
}

// The content width the image is being sized against — its own line box, not
// the pane, so an image inside a list indent gets the honest number.
function _mdlImgMaxW(img) {
  const p = img.parentElement;
  if (!p) return _MDL_IMG_MIN_W;
  const cs = getComputedStyle(p);
  const w = p.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
  return Math.max(_MDL_IMG_MIN_W, Math.round(w));
}

function _mdlClearImgSel(inst) {
  const sel = inst.imgSel;
  if (!sel) return;
  inst.imgSel = null;
  window.removeEventListener('resize', sel.reflow);
  document.removeEventListener('mousedown', sel.outside);
  sel.ui?.remove();
}

// Called on every mutation path that throws block elements away, so a stale
// overlay can never outlive the <img> it was measuring.
function _mdlDropImgSel(inst) { if (inst && inst.imgSel) _mdlClearImgSel(inst); }

function _mdlSelectImage(inst, img) {
  // Raw-HTML <img> in the markdown: no `![…](…)` span to write back to, so it
  // is not ours to resize. Better to leave it inert than to offer a grip that
  // silently does nothing.
  if (!img || !img.dataset.ppSrc) return;

  _mdlClearImgSel(inst);

  // Leaving another block active would keep its raw markers on screen while
  // the user is plainly working on an image somewhere else. Deactivate FIRST:
  // it re-renders that block, which changes the layout the overlay is about to
  // be measured against.
  if (inst.active !== -1) _mdlDeactivate(inst);

  const blockEl = _mdlBlockElOf(inst, img);
  if (!blockEl) return;
  const i = [...inst.root.children].indexOf(blockEl);
  if (i === -1 || !inst.blocks[i]) return;

  const href = img.dataset.ppSrc;
  const same = [...blockEl.querySelectorAll('img')].filter(x => x.dataset.ppSrc === href);

  const sel = { i, img, blockEl, href, n: same.indexOf(img), ui: null, reflow: null };
  sel.reflow = () => { if (inst.imgSel === sel) _mdlPlaceImgUI(inst); };
  // A click outside the editor entirely. It cannot fire for the click that made
  // this selection, because that one was stopped in root's capture phase and
  // never reaches the document. isConnected is the escape hatch for a
  // renderCurrentView() that wiped the editor while an image was selected.
  sel.outside = e => {
    if (!inst.root.isConnected) { _mdlClearImgSel(inst); return; }
    if (!inst.root.contains(e.target)) _mdlClearImgSel(inst);
  };
  inst.imgSel = sel;

  _mdlBuildImgUI(inst, sel);
  window.addEventListener('resize', sel.reflow);
  document.addEventListener('mousedown', sel.outside);

  // The click that got here was preventDefault()ed, so the browser neither
  // focused the editor nor placed a caret. Focus is needed for Backspace and
  // Escape to arrive at all; the empty selection is deliberate — a caret parked
  // in an INACTIVE block is how you end up typing into rendered HTML that
  // nothing ever commits.
  inst.root.focus({ preventScroll: true });
  try { window.getSelection()?.removeAllRanges(); } catch { /* no selection to clear */ }

  // An image that hasn't decoded yet has a zero box, so the frame would land
  // on nothing. Re-measure once it has one.
  if (!img.complete) img.addEventListener('load', sel.reflow, { once: true });
}

function _mdlBuildImgUI(inst, sel) {
  const ui = document.createElement('div');
  ui.className = 'mdl-img-ui';
  ui.setAttribute('contenteditable', 'false');

  const frame = document.createElement('div');
  frame.className = 'mdl-img-frame';
  const grip = document.createElement('span');
  grip.className = 'mdl-img-grip';
  grip.title = 'Drag to resize';
  frame.appendChild(grip);

  const bar = document.createElement('div');
  bar.className = 'mdl-img-bar';

  const input = document.createElement('input');
  input.className = 'mdl-img-w';
  input.type = 'number';
  input.min = String(_MDL_IMG_MIN_W);
  input.step = '10';
  input.title = 'Width in pixels';

  const unit = document.createElement('span');
  unit.className = 'mdl-img-unit';
  unit.textContent = 'px';
  bar.appendChild(input);
  bar.appendChild(unit);

  // Percentages of the column rather than fixed pixel presets: the same button
  // then means the same thing in the 860px detail pane and on a phone.
  [25, 50, 75].forEach(pct => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mdl-img-preset';
    b.textContent = pct + '%';
    b.addEventListener('click', () =>
      _mdlWriteImgWidth(inst, Math.round(_mdlImgMaxW(sel.img) * pct / 100)));
    bar.appendChild(b);
  });

  const auto = document.createElement('button');
  auto.type = 'button';
  auto.className = 'mdl-img-preset mdl-img-auto';
  auto.textContent = 'Auto';
  auto.title = 'Remove the size — the image fits the column';
  auto.addEventListener('click', () => _mdlWriteImgWidth(inst, 0));
  bar.appendChild(auto);

  const commit = () => {
    const v = parseInt(input.value, 10);
    _mdlWriteImgWidth(inst, Number.isNaN(v) ? 0 : v);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    e.stopPropagation();          // Ctrl+Z in the field is the field's own undo
  });

  _mdlWireImgGrip(inst, sel, grip);

  ui.appendChild(frame);
  ui.appendChild(bar);
  sel.blockEl.appendChild(ui);
  sel.ui = ui;
  sel.frame = frame;
  sel.bar = bar;
  sel.input = input;

  _mdlPlaceImgUI(inst);
}

// Pointer events, not mouse: this is the one gesture in the app that has to
// work under a finger, and setPointerCapture keeps the drag alive when the
// pointer leaves the grip — which it does immediately, by definition.
function _mdlWireImgGrip(inst, sel, grip) {
  let startX = 0, startW = 0, maxW = 0, live = 0, dragging = false;

  grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    startX = e.clientX;
    startW = sel.img.getBoundingClientRect().width;
    maxW = _mdlImgMaxW(sel.img);
    live = Math.round(startW);
    grip.setPointerCapture?.(e.pointerId);
    sel.ui.classList.add('mdl-img-ui--resizing');
  });

  grip.addEventListener('pointermove', e => {
    if (!dragging) return;
    e.preventDefault();
    live = Math.max(_MDL_IMG_MIN_W, Math.min(maxW, Math.round(startW + (e.clientX - startX))));
    // Preview on the element only. Rewriting the source per pointermove would
    // put a hundred entries on the undo stack for one drag and re-render the
    // block out from under the pointer.
    sel.img.style.width = live + 'px';
    sel.img.style.height = 'auto';
    sel.input.value = String(live);
    _mdlPlaceImgUI(inst);
  });

  const end = e => {
    if (!dragging) return;
    dragging = false;
    grip.releasePointerCapture?.(e.pointerId);
    sel.ui.classList.remove('mdl-img-ui--resizing');
    _mdlWriteImgWidth(inst, live);      // one source edit, one undo step
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

function _mdlPlaceImgUI(inst) {
  const sel = inst.imgSel;
  if (!sel || !sel.ui || !sel.img.isConnected) return;

  const ib = sel.img.getBoundingClientRect();
  const bb = sel.blockEl.getBoundingClientRect();
  const left = ib.left - bb.left, top = ib.top - bb.top;

  sel.frame.style.left   = left + 'px';
  sel.frame.style.top    = top + 'px';
  sel.frame.style.width  = ib.width + 'px';
  sel.frame.style.height = ib.height + 'px';

  /* The bar rides ON the image, inset from its bottom-left corner. Anywhere
     OUTSIDE the image box it lands on the neighbouring paragraph instead: the
     overlay is absolute, so the block's box never grows to make room for it,
     and .md-live clips at 600px so there is no guaranteed gutter either way.
     On the image it is attached to the thing it edits and can collide with
     nothing. The exception is an image too short to hold it, which by the same
     token is too short to be worth covering. */
  const inset = 8;
  const fits  = ib.height >= _MDL_IMG_BAR_H + inset * 2;

  sel.bar.style.left = (left + (fits ? inset : 0)) + 'px';
  sel.bar.style.top  = (fits ? top + ib.height - _MDL_IMG_BAR_H - inset
                             : top + ib.height + 6) + 'px';

  if (document.activeElement !== sel.input) sel.input.value = String(Math.round(ib.width));
}

/* The only writer. Rewrites ONE image's alt suffix inside one block's text,
   leaving every other character — and every other image in that block —
   exactly as it was. w = 0 removes the suffix ("Auto"). */
function _mdlWriteImgWidth(inst, w) {
  const sel = inst.imgSel;
  if (!sel) return;
  const b = inst.blocks[sel.i];
  if (!b) { _mdlClearImgSel(inst); return; }

  const span = _mdlImgSpans(b.text).filter(s => s.href === sel.href)[sel.n];
  if (!span) { _mdlClearImgSel(inst); return; }   // the source moved under us

  const width = w ? Math.max(_MDL_IMG_MIN_W, Math.min(_mdlImgMaxW(sel.img), Math.round(w))) : 0;
  const alt = imgAltWithSize(imgSizeFromAlt(span.alt).alt, width, 0);
  const next = b.text.slice(0, span.altStart) + alt + b.text.slice(span.altEnd);
  if (next === b.text) { _mdlPlaceImgUI(inst); return; }

  _mdlPush(inst);                       // the state we are leaving
  b.text = next;
  inst.md = _mdlJoin(inst);
  const href = sel.href, i = sel.i, n = sel.n;
  _mdlClearImgSel(inst);                // the overlay's <img> is about to be replaced
  _mdlRenderInactive(inst, inst.blocks[i]);
  inst.fire();                          // INV-2: onChange and Save see it now
  _mdlPush(inst);

  // Re-attach to the same image so the drag can continue where it left off.
  const again = [...inst.blocks[i].el.querySelectorAll('img')].filter(x => x.dataset.ppSrc === href)[n];
  if (again) _mdlSelectImage(inst, again);
}

// Backspace/Delete on a selected image removes the whole `![…](…)`. Through
// _mdlSetTexts, so it is one undo step and an emptied block survives as an
// empty paragraph rather than being swallowed by a re-lex.
function _mdlDeleteImg(inst) {
  const sel = inst.imgSel;
  if (!sel) return;
  const b = inst.blocks[sel.i];
  if (!b) { _mdlClearImgSel(inst); return; }
  const span = _mdlImgSpans(b.text).filter(s => s.href === sel.href)[sel.n];
  if (!span) { _mdlClearImgSel(inst); return; }

  const texts = _mdlTexts(inst);
  texts[sel.i] = b.text.slice(0, span.start) + b.text.slice(span.end);
  const caret = _mdlStart(inst, sel.i) + span.start;
  _mdlClearImgSel(inst);
  _mdlSetTexts(inst, texts, caret);
}

/* ── Public ────────────────────────────────────────────────────── */

/**
 * makeLiveEditor(content, onChange, opts) → { element, getMarkdown, setMarkdown, focus }
 *
 * Same read-only contract as makeMdPanel: with no editMode or no onChange you
 * get a plain rendered .preview-only div with live refs, so it is safe on both
 * paths.
 */
function makeLiveEditor(content, onChange, opts) {
  const o = opts || {};
  if (!State.editMode || typeof onChange !== 'function') {
    const div = document.createElement('div');
    div.className = 'preview-only' + (o.className ? ' ' + o.className : '');
    div.innerHTML = renderMarkdown(content);
    bindRefLinks(div);
    return { element: div, getMarkdown: () => _mdlNorm(content), setMarkdown() {},
             getSelection: () => ({ a: 0, b: 0 }), applyMarkdown() {}, focus() {} };
  }

  const root = document.createElement('div');
  root.className = 'mdl-root preview-only' + (o.className ? ' ' + o.className : '');
  root.setAttribute('contenteditable', 'true');
  root.setAttribute('spellcheck', 'true');
  if (o.placeholder) root.dataset.mdlPlaceholder = o.placeholder;

  const inst = {
    root, blocks: [], active: -1, md: _mdlNorm(content),
    sel: { a: 0, b: 0 }, hist: _mdlHist(), composing: false,
    imgSel: null,              // the image being sized, if any (see Image sizing)
    onChange,
    fire() { onChange(inst.md); },
  };

  _mdlBuild(inst);
  _mdlPush(inst);

  /* ── input: the hot path. Commit, then restyle only if the type changed. ── */
  root.addEventListener('input', () => {
    if (inst.composing) return;
    // Text that escaped into the root would never be committed — absorb it.
    if (_mdlHealRoot(inst)) { _mdlReadSel(inst); _mdlTouch(inst); inst.fire(); return; }
    if (inst.active === -1) { _mdlReadSel(inst); }
    const b = inst.blocks[inst.active];
    if (!b) { _mdlReadSel(inst); return; }

    // The browser may have split the block into several nodes. Restore INV-1.
    const inner = b.el.firstElementChild;
    if (!inner || b.el.childNodes.length !== 1) {
      const text = b.el.textContent;
      const off = _mdlOffsetIn(b.el, window.getSelection().getRangeAt(0).startContainer,
                               window.getSelection().getRangeAt(0).startOffset);
      b.text = text;
      _mdlMountActive(inst, b);
      _mdlSetOffsetIn(b.el, off);
    }

    _mdlCommit(inst);
    const text = _mdlText(b);
    const k = _mdlClassify(text);
    if (_mdlKey(k) !== b.el.dataset.mdlKey) {
      const off = _mdlOffsetIn(b.el, window.getSelection().getRangeAt(0).startContainer,
                               window.getSelection().getRangeAt(0).startOffset);
      _mdlMountActive(inst, b);          // swap the inner tag; text is unchanged
      _mdlSetOffsetIn(b.el, off);
    }
    _mdlReadSel(inst);
    _mdlTouch(inst);
    inst.fire();
  });

  /* ── beforeinput: intercept structural intent only ── */
  root.addEventListener('beforeinput', e => {
    if (inst.composing) return;
    _mdlEnsureInBlock(inst);      // before anything is typed, not after
    const t = e.inputType;
    if (t.startsWith('insertComposition') || t === 'insertReplacementText') return;

    if (t === 'historyUndo') { e.preventDefault(); _mdlStep(inst, -1); return; }
    if (t === 'historyRedo') { e.preventDefault(); _mdlStep(inst, +1); return; }
    if (t === 'insertFromPaste' || t === 'insertFromDrop') { e.preventDefault(); return; }

    _mdlReadSel(inst);
    // An edit spanning more than one block goes through the splice path, so the
    // browser never gets to merge two block elements on its own.
    if (inst.sel.a !== inst.sel.b &&
        _mdlBlockIndexAt(inst, inst.sel.a) !== _mdlBlockIndexAt(inst, inst.sel.b)) {
      e.preventDefault();
      _mdlInsertText(inst, t.startsWith('insert') ? (e.data || '') : '');
      return;
    }
    if (t === 'insertParagraph') { e.preventDefault(); _mdlEnter(inst, false); return; }
    if (t === 'insertLineBreak') { e.preventDefault(); _mdlEnter(inst, true);  return; }

    const blk = inst.blocks[_mdlBlockIndexAt(inst, inst.sel.a)];
    if (!blk) return;
    const off = inst.sel.a - _mdlStart(inst, _mdlBlockIndexAt(inst, inst.sel.a));
    if (t === 'deleteContentBackward' && inst.sel.a === inst.sel.b && off === 0) {
      e.preventDefault(); _mdlBackspaceEdge(inst); return;
    }
    if (t === 'deleteContentForward' && inst.sel.a === inst.sel.b && off >= _mdlText(blk).length) {
      e.preventDefault(); _mdlDeleteEdge(inst); return;
    }
    // Anything else is native: zero latency, and `input` recomputes the styling.
  });

  /* ── keys we own: undo/redo, and Tab only inside a list ── */
  root.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault(); _mdlStep(inst, e.shiftKey ? +1 : -1); return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); _mdlStep(inst, +1); return; }
    if (e.key === 'Tab') {
      _mdlReadSel(inst);
      const blk = inst.blocks[_mdlBlockIndexAt(inst, inst.sel.a)];
      // Only steal Tab from focus traversal when it plainly means "indent".
      if (!blk || _mdlClassify(_mdlText(blk)).block !== 'list') return;
      e.preventDefault();
      const ls = inst.md.lastIndexOf('\n', inst.sel.a - 1) + 1;
      if (e.shiftKey) {
        const cut = /^ {1,2}/.exec(inst.md.slice(ls));
        if (cut) _mdlApply(inst, inst.md.slice(0, ls) + inst.md.slice(ls + cut[0].length),
                           inst.sel.a - cut[0].length);
      } else {
        _mdlApply(inst, inst.md.slice(0, ls) + '  ' + inst.md.slice(ls), inst.sel.a + 2);
      }
    }
  });

  /* ── clipboard: the source, not the rendered text ── */
  root.addEventListener('paste', e => {
    e.preventDefault();
    _mdlReadSel(inst);
    const dt = e.clipboardData;
    _mdlInsertText(inst, dt ? (dt.getData('text/plain') || _mdlStrip(dt.getData('text/html'))) : '');
  });

  // Native copy of a multi-block selection would take the RENDERED text of the
  // inactive blocks — markers silently gone. Hand over the source instead.
  const onCopy = cut => e => {
    _mdlReadSel(inst);
    if (inst.sel.a === inst.sel.b) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', inst.md.slice(inst.sel.a, inst.sel.b));
    if (cut) _mdlInsertText(inst, '');
  };
  root.addEventListener('copy', onCopy(false));
  root.addEventListener('cut',  onCopy(true));

  /* ── IME: never fight a composition in progress ── */
  root.addEventListener('compositionstart', () => { inst.composing = true; });
  root.addEventListener('compositionend', () => {
    inst.composing = false;
    _mdlCommit(inst);
    _mdlReadSel(inst);
    _mdlTouch(inst);
    inst.fire();
  });

  /* ── activation: which block the caret is in ── */
  const sync = () => {
    _mdlReadSel(inst);
    const i = _mdlBlockIndexAt(inst, inst.sel.a);
    if (i !== inst.active) {
      const off = inst.sel.a - _mdlStart(inst, i);
      _mdlActivate(inst, i);
      const b = inst.blocks[i];
      if (b) _mdlSetOffsetIn(b.el, Math.min(off, _mdlText(b).length));
    }
  };
  root.addEventListener('keyup', e => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') sync(); });

  // Clicking a rendered block: let the browser tell us which character was hit,
  // then re-probe the same point after the raw markers appear. Lands within a
  // character or two — and the line reflows anyway, so exactness is illusory.
  root.addEventListener('mousedown', e => {
    const el = _mdlBlockElOf(inst, e.target);
    if (!el) return;
    const i = [...root.children].indexOf(el);
    if (i === -1 || i === inst.active) return;
    // Measure the click against the RENDERED block, BEFORE activation changes
    // the layout. Probing afterwards is what put the caret in a neighbouring
    // block: activating shifts the text, so the same coordinates no longer
    // point where the user aimed, and typing then edited rendered HTML that
    // never got committed. Mapping the offset instead is layout-independent.
    const hit = _mdlCaretFromPoint(e.clientX, e.clientY);
    const box = el.getBoundingClientRect();
    const viz = hit && el.contains(hit.node)
      ? _mdlOffsetIn(el, hit.node, hit.offset)
      // Clicked the block's padding rather than its text: nearest end.
      : (e.clientY > box.top + box.height / 2 ? Infinity : 0);
    const off = viz === Infinity ? inst.blocks[i].text.length
                                 : _mdlSrcFromViz(inst.blocks[i].text, viz);

    e.preventDefault();          // we place the caret ourselves, not the browser
    root.focus();                // BEFORE placing it: focusing can collapse a
    _mdlActivate(inst, i);       // selection that was set first
    _mdlSetOffsetIn(inst.blocks[i].el, off);
    _mdlReadSel(inst);
  });

  /* ── Selecting an image ───────────────────────────────────────────
     CAPTURE phase, and that is the whole trick: the mousedown handler above is
     bound to this same element in the bubble phase, so a capture listener here
     runs before the event ever reaches the image — stopPropagation() then means
     the click never becomes "put the caret in that block", which would swap the
     image for its raw `![…](…)` text under the pointer. */
  root.addEventListener('mousedown', e => {
    // Our own chrome: swallow it so the block stays put. NOT preventDefault —
    // the width field still has to be able to take focus.
    if (e.target.closest?.('.mdl-img-ui')) { e.stopPropagation(); return; }

    if (e.target.tagName === 'IMG' && e.target.dataset.ppSrc) {
      e.preventDefault();
      e.stopPropagation();
      _mdlSelectImage(inst, e.target);
      return;
    }
    _mdlDropImgSel(inst);       // clicked away: back to ordinary text editing
  }, true);

  /* Keys while an image is selected. Also capture, so Backspace here can never
     fall through to the structural Backspace below and merge two blocks. */
  root.addEventListener('keydown', e => {
    if (!inst.imgSel) return;
    if (e.target.closest?.('.mdl-img-ui')) return;    // digits typed into the width field
    // Ctrl+Z is not "typing a z". Every shortcut belongs to the handlers below,
    // including undo — which is how you take a resize back.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault(); e.stopPropagation(); _mdlDeleteImg(inst); return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); _mdlDropImgSel(inst); return; }
    // A printable key means "I'm done with the image" — but it is NOT inserted.
    // There is deliberately no caret while an image is selected (see above), so
    // there is no honest place to put the character; guessing one would land it
    // in a block the user never pointed at. Deselect, and let them click.
    if (e.key.length === 1 || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); _mdlDropImgSel(inst); }
  }, true);

  // Refs are styled but must never navigate out of an unsaved edit — the same
  // discipline md-panel applies to its preview pane, widened to every anchor.
  root.addEventListener('click', e => { if (e.target.closest?.('a')) e.preventDefault(); });

  root.addEventListener('focusout', () => { _mdlCommit(inst); _mdlPush(inst); });

  return {
    element: root,
    getMarkdown() { _mdlCommit(inst); return inst.md; },
    setMarkdown(v) {
      inst.md = _mdlNorm(v);
      inst.hist = _mdlHist();
      _mdlBuild(inst);
      _mdlPush(inst);
    },
    // The caret as absolute offsets into the SOURCE, which is the same
    // coordinate space a textarea's selectionStart/End use. That correspondence
    // is what lets md-panel's toolbar act on the pane the writer can actually
    // see; inst.sel is already maintained in these units.
    getSelection() { _mdlCommit(inst); return { ...inst.sel }; },
    // The write half of the same contract: replace the document, place the
    // caret, fire onChange. Unlike setMarkdown this keeps the undo stack, so a
    // toolbar insertion is one more step the writer can take back.
    applyMarkdown(md, caret) { _mdlApply(inst, md, caret); },
    focus() { root.focus(); },
  };
}

// Last-resort plain text from an HTML-only clipboard payload. No HTML-to-
// markdown conversion in v1 — better to paste readable text than bad markup.
function _mdlStrip(html) {
  if (!html) return '';
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.textContent || '';
}
