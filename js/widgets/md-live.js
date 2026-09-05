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
