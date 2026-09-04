/**
 * Markdown panel.
 *   Edit mode → toolbar (formatting + a Code/Split/Preview view toggle) over a
 *     body holding the textarea and a live preview; the toggle picks which are
 *     shown (data-mode on .md-panel; CSS does the layout).
 *   View mode → rendered HTML only.
 * onChange(val) is called whenever the text changes (typing or toolbar).
 */
function makeMdPanel(content, onChange) {
  if (!State.editMode || typeof onChange !== 'function') {
    const div = document.createElement('div');
    div.className = 'preview-only';
    div.innerHTML = renderMarkdown(content);
    bindRefLinks(div);
    return div;
  }

  const panel   = UI.make('div').class('md-panel').getElement();
  const ta      = UI.make('textarea').class('md-textarea').value(content).getElement();
  const preview = UI.make('div').class('md-preview', 'preview-only').getElement();

  // Re-render the live preview from the current textarea value. Refs are styled
  // but inert here so a stray click can't navigate away and lose unsaved edits.
  const renderPreview = () => {
    preview.innerHTML = renderMarkdown(ta.value);
    preview.querySelectorAll('.ref-link').forEach(a => a.addEventListener('click', e => e.preventDefault()));
  };

  const fire = () => { onChange(ta.value); if (panel.dataset.mode !== 'code') renderPreview(); };
  ta.addEventListener('input', fire);

  // Code / Split / Preview segmented toggle.
  const seg = UI.make('div').class('md-view-seg');
  const segBtns = [];
  const setMode = m => {
    panel.dataset.mode = m;
    segBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    if (m !== 'code') renderPreview();
  };
  [['code', 'Code'], ['split', 'Split'], ['preview', 'Preview']].forEach(([m, label]) => {
    const b = UI.make('button').class('md-view-btn').attrs({ type: 'button', 'data-mode': m, title: label + ' view' })
      .text(label).on('click', () => setMode(m)).getElement();
    segBtns.push(b);
    seg.getElement().appendChild(b);
  });

  const toolbar = _mdToolbar(ta, fire).getElement();
  toolbar.querySelector('.md-toolbar').appendChild(seg.getElement());   // sits right via margin-left:auto

  const body = UI.make('div').class('md-body').getElement();
  body.appendChild(ta);
  body.appendChild(preview);

  panel.appendChild(toolbar);
  panel.appendChild(body);
  setMode('code');                                                       // preserves the original default
  return panel;
}

/* ── Text-editing helpers (operate on the textarea selection) ── */

function _mdHeading(ta, level, fire) {
  const v = ta.value, s = ta.selectionStart;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  let le = v.indexOf('\n', s); if (le === -1) le = v.length;
  const line = v.slice(ls, le).replace(/^#{1,6}\s*/, '');
  const prefix = '#'.repeat(level) + ' ';
  ta.value = v.slice(0, ls) + prefix + line + v.slice(le);
  const pos = ls + prefix.length + line.length;
  ta.focus(); ta.setSelectionRange(pos, pos); fire();
}

function _mdLinePrefix(ta, prefix, fire) {
  const v = ta.value, s = ta.selectionStart;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  ta.value = v.slice(0, ls) + prefix + v.slice(ls);
  const pos = s + prefix.length;
  ta.focus(); ta.setSelectionRange(pos, pos); fire();
}

function _mdWrap(ta, before, after, placeholder, fire) {
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || placeholder;
  ta.value = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
  ta.focus();
  ta.setSelectionRange(s + before.length, s + before.length + sel.length);
  fire();
}

function _mdInsert(ta, text, fire) {
  const s = ta.selectionStart;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(ta.selectionEnd);
  const pos = s + text.length;
  ta.focus(); ta.setSelectionRange(pos, pos); fire();
}

// Insert an inline reference, always in #display:reference# form so the display
// text is independent of the entry's name. The display part is left selected so
// the writer can immediately type their own wording.
function _mdInsertRef(ta, key, fire, displayDefault) {
  const s = ta.selectionStart, e = ta.selectionEnd;
  const display = ta.value.slice(s, e).trim() || displayDefault || key;
  const token = `#${display}:${key}#`;
  ta.value = ta.value.slice(0, s) + token + ta.value.slice(e);
  ta.focus();
  const dispStart = s + 1;                       // just after the opening '#'
  ta.setSelectionRange(dispStart, dispStart + display.length);
  fire();
}

// Reference targets: every item (key = its name) plus every group/menu
// (key = its slug, so it resolves independently of its display name).
function _mdRefItems() {
  const out = [];
  (State.data?.groups || []).forEach(g => {
    out.push({ name: g.name, key: g.slug, group: 'Section', isGroup: true });
    (g.items || []).forEach(it => { if (it.name) out.push({ name: it.name, key: it.name, group: g.name }); });
  });
  return out;
}

/* ── Toolbar ── */

function _mdToolbar(ta, fire) {
  const btn = (label, title, onClick, extraClass) =>
    UI.make('button').class('md-tool', extraClass || '').attrs({ type: 'button', title })
      .text(label).on('click', e => { e.preventDefault(); onClick(); });

  const sep = () => UI.make('span').class('md-sep');

  // Reference picker (inline panel, toggled by the Reference button)
  const refPop = UI.make('div').class('md-ref-pop', 'hidden');
  const search = UI.make('input').class('md-ref-search').attrs({ placeholder: 'Search entries…' });
  const refList = UI.make('div').class('md-ref-list');
  refPop.withChilds(search, refList);

  const pop = refPop.getElement();
  const searchEl = search.getElement();
  function closeRef() { pop.classList.add('hidden'); document.removeEventListener('click', onDocClick); }
  function onDocClick(e) { if (!pop.contains(e.target) && e.target !== refBtnEl) closeRef(); }
  function openRef() {
    pop.classList.remove('hidden');
    searchEl.value = '';
    _fillRefPop(refPop, ta, fire, searchEl, closeRef);
    searchEl.focus();                                  // focus the search on open
    setTimeout(() => document.addEventListener('click', onDocClick), 0); // close on outside click
  }
  search.on('input', () => _fillRefPop(refPop, ta, fire, searchEl, closeRef));

  const refBtn = UI.make('button').class('md-tool').attrs({ type: 'button', title: 'Insert a link to another entry' })
    .text('Reference').on('click', e => {
      e.preventDefault(); e.stopPropagation();
      pop.classList.contains('hidden') ? openRef() : closeRef();
    });
  const refBtnEl = refBtn.getElement();

  const bar = UI.make('div').class('md-toolbar').withChilds(
    btn('H1', 'Heading 1', () => _mdHeading(ta, 1, fire)),
    btn('H2', 'Heading 2', () => _mdHeading(ta, 2, fire)),
    btn('H3', 'Heading 3', () => _mdHeading(ta, 3, fire)),
    btn('H4', 'Heading 4', () => _mdHeading(ta, 4, fire)),
    sep(),
    btn('B', 'Bold', () => _mdWrap(ta, '**', '**', 'bold', fire), 'md-tool--b'),
    btn('I', 'Italic', () => _mdWrap(ta, '*', '*', 'italic', fire), 'md-tool--i'),
    btn('Code', 'Inline code', () => _mdWrap(ta, '`', '`', 'code', fire)),
    btn('Link', 'Link', () => _mdWrap(ta, '[', '](https://)', 'text', fire)),
    sep(),
    btn('Quote', 'Quote', () => _mdLinePrefix(ta, '> ', fire)),
    btn('List', 'Bullet list', () => _mdLinePrefix(ta, '- ', fire)),
    btn('Rule', 'Horizontal rule', () => _mdInsert(ta, '\n\n---\n\n', fire)),
    sep(),
    refBtn
  );

  return UI.make('div').class('md-toolbar-wrap').withChilds(bar, refPop);
}

function _fillRefPop(refPop, ta, fire, searchEl, close) {
  const list = refPop.getElement().querySelector('.md-ref-list');
  const q = (searchEl.value || '').toLowerCase();
  const items = _mdRefItems().filter(it => it.name.toLowerCase().includes(q));
  list.innerHTML = '';
  if (!items.length) {
    list.appendChild(UI.make('div').class('md-ref-empty').text('No entries found.').getElement());
    return;
  }
  items.slice(0, 50).forEach(it => {
    list.appendChild(
      UI.make('div').class('md-ref-item')
        .withChilds(UI.make('span').text(it.name), UI.make('span').class('md-ref-group').text(it.group))
        .on('click', () => { _mdInsertRef(ta, it.key, fire, it.name); close(); })
        .getElement()
    );
  });
}
