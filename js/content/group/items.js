/**
 * A group's items, laid out the way this viewer asked for.
 *
 * Two shapes for the same data: cards answer "what's in here?", the expanded
 * view answers "let me read the whole thing". Both live here so the manual
 * order, the drag wiring and the "new" indicator can't drift apart.
 *
 * Deliberately order-blind — callers hand over the entries they already have,
 * in the order they want them, so list.js passes natural order and graph.js its
 * topological sort without this file knowing either exists.
 *
 *   entries   [{ item, i, … }, …] in display order. `i` is the index into
 *             group.items — what navigateToItem() and the drag reorder
 *             address — NOT the display position.
 *   singular  noun for the "new item" affordance ("Character", "Beat", …).
 *   canDrop   optional (fromEntry, toEntry) => bool. Graph groups restrict
 *             drops to the same topological level, because there a manual
 *             order can only break ties inside a level.
 */
function groupItemsEl(group, entries, singular, canDrop) {
  return groupViewMode(group.slug) === VIEW_EXPANDED
    ? _itemsExpanded(group, entries, singular)
    : _itemsCards(group, entries, singular, canDrop);
}

/* ── Cards: the default grid ───────────────────────────────────── */

function _itemsCards(group, entries, singular, canDrop) {
  const grid = UI.make('div').class('list-view');

  entries.forEach(entry => {
    // The plain wrapper div is deliberate: it becomes the grid item and
    // stretches, while the card inside sizes to its own content. Dropping it
    // would make .item-card the grid item and force equal row heights.
    grid.withChilds(UI.make('div').execute(el => {
      const card = makeItemCard(entry.item, () => navigateToItem(group.slug, entry.i),
                                itemIsUnseen(group.slug, entry.item));
      if (State.editMode) _wireCardDrag(card, group, entry, canDrop);
      el.appendChild(card);
    }));
  });

  if (State.editMode)
    grid.withChilds(
      UI.make('div').class('item-card', 'new-item-card')
        .text('+ New ' + singular)
        .on('click', () => navigateToNewItem(group.slug))
    );
  else if (!entries.length)
    grid.withChilds(UI.make('p').style({ color: 'var(--text-muted)', padding: '12px' }).text('Nothing here yet.'));

  return grid.getElement();
}

/* ── Manual order ──────────────────────────────────────────────────
   The order IS the array order: for a list group group.items is already the
   display order, XML round-trips it and saveWorld persists the whole blob, so
   a separate `order` field would only be a second source of truth. Safe for
   everything that addresses an item — permalinks and seen keys use item.id,
   and item.parents stores names, which _computeLevels re-indexes each render.
   State.currentItem.itemIndex IS positional, but the drag UI only exists on
   the card grid, where navigate() has already cleared it. */

// Move one item to another item's position. Both are indices into group.items.
function _moveItem(group, from, to) {
  const items = group.items || [];
  if (from === to || !items[from] || !items[to]) return;
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  saveData();
}

function _dragAccepts(entry, target, canDrop) {
  if (entry === target) return false;
  return canDrop ? !!canDrop(entry, target) : true;
}

// Edit mode only, and only on real cards — never the "+ New" tile.
// The source index has to be read from the drag source at dragstart, which is
// why entry is captured per card rather than looked up on drop.
function _wireCardDrag(el, group, entry, canDrop) {
  el.draggable = true;
  el.classList.add('item-card--drag');

  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', String(entry.i));
    e.dataTransfer.effectAllowed = 'move';
    _dragEntry = entry;
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => { _dragEntry = null; el.classList.remove('dragging'); });

  el.addEventListener('dragover', e => {
    // Not calling preventDefault leaves the "no drop" cursor — the honest
    // signal for a target that can't accept this item.
    if (!_dragEntry || !_dragAccepts(_dragEntry, entry, canDrop)) return;
    e.preventDefault();
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));

  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('drag-over');
    const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (Number.isNaN(from)) return;
    _moveItem(group, from, entry.i);
    renderCurrentView();
  });
}

// The entry being dragged. dragover can't read dataTransfer (browsers hide it
// outside dragstart/drop), so the source is remembered here to answer canDrop.
let _dragEntry = null;

/* ── Expanded: every entry inline, in full ─────────────────────── */

function _itemsExpanded(group, entries, singular) {
  _resetDotWatch();     // the previous render's nodes are about to be discarded

  const box = UI.make('div').class('expanded-view');
  entries.forEach(e => box.withChilds(_expandedSection(group, e.item, e.i)));

  if (State.editMode)
    // Not the dashed .new-item-card: that shape means "cell in a grid" and
    // reads as a stray box at the foot of a column of prose.
    box.withChilds(UI.make('button').class('btn-secondary', 'expanded-new')
      .innerHTML(Icons.label('plus', 'New ' + singular))
      .on('click', () => navigateToNewItem(group.slug)));
  else if (!entries.length)
    box.withChilds(UI.make('p').class('expanded-empty').text('Nothing here yet.'));

  return box.getElement();
}

function _expandedSection(group, item, i) {
  // A real <a href>, so hover status, middle-click and open-in-new-tab all
  // work and the section is the same thing Copy link copies. A plain click is
  // still routed through the router rather than reloading the page.
  const title = UI.make('h2').class('expanded-title').withChilds(
    UI.make('a').attrs({ href: Url.itemLink(group.slug, item) })
      .text(item.name || 'Untitled')
      .on('click', e => { e.preventDefault(); navigateToItem(group.slug, i); })
  );

  const head = UI.make('div').class('expanded-head').withChilds(
    UI.make('div').class('expanded-title-wrap').withChilds(_unseenDot(group, item), title)
  );

  const sec = UI.make('article').class('expanded-item')
    .dataset({ itemId: item.id || '' })
    .withChilds(head);

  if (group.type === 'graph' && item.parents?.length)
    sec.withChilds(UI.make('p').class('item-meta', 'expanded-meta').text('↳ ' + item.parents.join(', ')));

  // _expandedEditor appends its own buttons to `head`, so it has to run while
  // head is still being assembled — before the body is appended below it.
  sec.withChilds(State.editMode ? _expandedEditor(group, item, head) : _expandedBody(item));

  _watchDot(group, item, sec.getElement());
  return sec;
}

// Read mode: rendered markdown. makeMdPanel with NO onChange returns a plain
// .preview-only div with its #ref# links already bound — do NOT call
// bindRefLinks again on the container, that would double-fire every ref click.
function _expandedBody(item) {
  return item.content && item.content.trim()
    ? makeMdPanel(item.content)
    : UI.make('p').class('expanded-empty').text('No text yet.');
}

/* ── Inline editing (expanded + edit mode) ─────────────────────── */

// A plain textarea, not the full md-panel: N toolbars down a long page is
// noise, and the toolbar's ref picker and split preview are one click away on
// the card's own page. Save writes only content + updatedAt — the name,
// parents and everything structural stay on that page, so there's no way to
// half-edit twenty entries' identities at once.
function _expandedEditor(group, item, head) {
  const save = UI.make('button').class('btn-primary', 'btn-sm', 'expanded-save', 'hidden')
    .attrs({ type: 'button' })
    .innerHTML(Icons.label('check', 'Save'));
  const edit = UI.make('button').class('btn-secondary', 'btn-sm')
    .attrs({ type: 'button' })
    .innerHTML(Icons.label('edit', 'Edit'))
    // Resolved at click time, not captured, so a drag reorder in between
    // can't send you to the wrong card.
    .on('click', () => navigateToItem(group.slug, (group.items || []).indexOf(item)));
  head.withChilds(UI.make('div').class('expanded-actions').withChilds(save, edit));

  let draft = item.content || '';
  // A contenteditable grows with its content, so the old _autoGrow dance and
  // its post-append timer are both gone; the height floor lives in CSS now.
  const live = makeLiveEditor(draft, v => {
    draft = v;
    save.getElement().classList.toggle('hidden', draft === (item.content || ''));
  }, { className: 'expanded-live', placeholder: 'Write in Markdown…' });

  save.on('click', () => {
    // Through getMarkdown(), not `draft`: Save can be clicked while a block is
    // active, and this commits that block's text first by construction.
    item.content   = live.getMarkdown();
    item.updatedAt = nowISO();     // what drives every other reader's "new" dot
    saveData();
    draft = item.content;
    save.getElement().classList.add('hidden');
  });

  return live.element;
}

/* ── The unseen dot ────────────────────────────────────────────────
   Cards keep their .card-new pill; expanded gets a dot beside the title,
   cleared as you read rather than in bulk on leave. So currentElementKey()
   and leaveCurrentElement() keep their present meaning — a list/graph
   overview still isn't itself an element. */

// .card-new is absolute inside .item-card, so it can't be reused inline;
// this is modelled on .menu-dot instead. itemIsUnseen() is already false for
// owners and for items with no id, so the dot simply never appears there.
function _unseenDot(group, item) {
  if (!itemIsUnseen(group.slug, item)) return null;
  return UI.make('span').class('expanded-dot').attrs({ title: 'New since your last visit' });
}

// Reading an entry clears its dot in place — no re-render, so it can't yank
// the page out from under someone mid-paragraph.
function _clearDot(group, item, sec) {
  const dot = sec.querySelector('.expanded-dot');
  if (!dot || !item.id || !State.currentWorld) return;
  dot.remove();
  markElementSeen(State.currentWorld.id, elKeyItem(group.slug, item.id));
  buildSidebar();   // this may have been the group's last unseen item
}

// Pointer devices get mouse-enter. Touch devices have no hover, so a section
// counts as read once it has been on screen for a moment — reading it IS the
// gesture, nothing extra to learn. matchMedia is a capability query, not a
// device sniff, so a hybrid laptop with a touchscreen still gets hover.
const _HOVERS = window.matchMedia?.('(hover: hover)')?.matches !== false;
const DOT_DWELL_MS = 1000;

let _dotObserver = null;
const _dotTimers = new Map();

// Called at the top of every expanded render: an IntersectionObserver holding
// nodes that renderCurrentView() just threw away is a leak.
function _resetDotWatch() {
  _dotObserver?.disconnect();
  _dotObserver = null;
  _dotTimers.forEach(t => clearTimeout(t));
  _dotTimers.clear();
}

function _watchDot(group, item, sec) {
  if (!item.id || !itemIsUnseen(group.slug, item)) return;

  if (_HOVERS) {
    sec.addEventListener('mouseenter', () => _clearDot(group, item, sec), { once: true });
    return;
  }
  if (!window.IntersectionObserver) return;   // no observer: the dot just persists

  // rootMargin, not threshold: a threshold is a fraction of the ELEMENT, and a
  // long entry — exactly what this view is for — can never show 40% of itself
  // in a shorter viewport, so it would never count as read. Shrinking the root
  // to its middle 70% instead means "actually on screen in front of you",
  // whatever the entry's height.
  _dotObserver ||= new IntersectionObserver(entries => {
    entries.forEach(({ target, isIntersecting }) => {
      if (isIntersecting && !_dotTimers.has(target)) {
        _dotTimers.set(target, setTimeout(() => {
          _dotObserver.unobserve(target);
          _dotTimers.delete(target);
          target._clearDot?.();
        }, DOT_DWELL_MS));
      } else if (!isIntersecting && _dotTimers.has(target)) {
        clearTimeout(_dotTimers.get(target));   // scrolled straight past — not read
        _dotTimers.delete(target);
      }
    });
  }, { threshold: 0, rootMargin: '-15% 0px -15% 0px' });

  sec._clearDot = () => _clearDot(group, item, sec);
  _dotObserver.observe(sec);
}
