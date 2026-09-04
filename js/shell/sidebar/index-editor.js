/* ── Index structure editor (order + nesting + visibility) ────── */

function renderIndexEditor() {
  const content = UI.get('main-content');
  content.innerHTML = '';

  const menuCount = (State.data.groups || []).filter(g => g.type === 'menu').length;

  const wrap = UI.make('div').class('detail-view');
  wrap.withChilds(
    UI.make('div').class('detail-bar').withChilds(
      UI.make('button').class('btn-secondary').innerHTML(Icons.label('back', 'Back')).on('click', () => navigate('home')),
      UI.make('button').class('btn-primary').innerHTML(Icons.label('plus', 'New menu folder')).on('click', _addMenuFolder)
    ),
    UI.make('h1').class('detail-title').text('Edit index'),
    UI.make('p').class('item-meta').text(menuCount
      ? 'Reorder, drop a group inside a menu, and set what readers can see.'
      : 'Create a menu folder first — then use each row’s “Inside” dropdown to nest groups under it.')
  );

  const list = UI.make('div').class('index-editor');
  const rows = flattenGroupTree();
  if (!rows.length)
    list.withChilds(UI.make('p').style({ color: 'var(--text-muted)' }).text('No groups yet.'));

  rows.forEach(({ group, depth }) => {
    const siblings = groupChildren(group.parentId || null);
    const pos = siblings.indexOf(group);

    const row = UI.make('div').class('index-row').style({ marginLeft: (depth * 22) + 'px' });

    const icon = UI.make('span').class('ic', 'index-type').innerHTML(Icons.get(groupTypeIcon(group)));
    const label = UI.make('span').class('index-name').text(group.name);
    if (group.isPublic === false) label.withChilds(UI.make('span').class('index-private').text('private'));

    // Parent picker: "Top level" + every menu that isn't this node or a descendant.
    const blocked = new Set(groupDescendantSlugs(group.slug));
    const parentSel = UI.make('select').class('idx-parent').attrs({ title: 'Move inside a menu' }).execute(sel => {
      sel.appendChild(new Option('Top level', ''));
      (State.data.groups || []).filter(g => g.type === 'menu' && !blocked.has(g.slug))
        .forEach(m => sel.appendChild(new Option('in: ' + m.name, m.slug)));
      sel.value = group.parentId || '';
      if (sel.options.length <= 1) sel.disabled = true;   // no menus to move into yet
    }).on('change', e => { _reparent(group, e.target.value || null); renderIndexEditor(); });

    const open = UI.make('button').class('idx-btn').innerHTML(Icons.label('settings', '')).attrs({ title: 'Settings' })
      .on('click', () => openGroupSettings(group.slug));

    const actions = UI.make('div').class('index-actions').withChilds(
      _idxBtn('↑', 'Move up',   pos > 0,                   () => { _swapSiblings(group, -1); renderIndexEditor(); }),
      _idxBtn('↓', 'Move down', pos < siblings.length - 1, () => { _swapSiblings(group, 1);  renderIndexEditor(); }),
      parentSel,
      _idxBtn(group.isPublic === false ? 'Show' : 'Hide', 'Toggle public', true, () => {
        group.isPublic = group.isPublic === false; saveData(); buildSidebar(); renderIndexEditor();
      }),
      open
    );

    row.withChilds(UI.make('span').class('index-label').withChilds(icon, label), actions);
    list.withChilds(row);
  });

  wrap.withChilds(list);
  content.appendChild(wrap.getElement());
}

function _idxBtn(glyph, title, enabled, onClick) {
  const b = UI.make('button').class('idx-btn').attrs({ title, type: 'button' }).text(glyph);
  if (!enabled) b.attrs({ disabled: 'disabled' });
  else b.on('click', onClick);
  return b;
}

// Quick-create a menu folder from the index editor (the only node type that can
// hold other groups), so nesting is reachable without leaving the screen.
function _addMenuFolder() {
  const name = (prompt('Name for the new menu folder:') || '').trim();
  if (!name) return;
  const slug = slugify(name);
  if (getGroup(slug)) { alert('"' + name + '" already exists.'); return; }
  State.data.groups.push({ name, slug, type: 'menu', isPublic: true });
  saveData(); buildSidebar(); renderIndexEditor();
}

// Swap a node with its previous/next sibling inside data.groups (dir = -1 | +1).
function _swapSiblings(group, dir) {
  const siblings = groupChildren(group.parentId || null);
  const pos = siblings.indexOf(group);
  const other = siblings[pos + dir];
  if (!other) return;
  const arr = State.data.groups;
  const a = arr.indexOf(group), b = arr.indexOf(other);
  [arr[a], arr[b]] = [arr[b], arr[a]];
  saveData(); buildSidebar();
}

// Move a node into a menu (or back to top level) and drop it at the bottom of
// its new siblings; the user can fine-tune order with the up/down arrows.
function _reparent(group, newParentId) {
  group.parentId = newParentId || null;
  const arr = State.data.groups;
  arr.splice(arr.indexOf(group), 1);
  arr.push(group);
  saveData(); buildSidebar();
}

