/**
 * Group settings, the index-structure editor, and the "menu" (folder) landing
 * view. All owner-only (gated by State.editMode / isOwner at the call sites).
 *
 * Group objects gained optional fields (additive, persisted by saveWorld):
 *   intro        markdown shown above a group's items / text
 *   itemTemplate default body for new items (list/graph only)
 *   isPublic     false → hidden from non-owners (UI-level; see note below)
 *   parentId     parent menu's slug, or null/absent for top level
 *   type:'menu'  a folder node with no content of its own
 *
 * PRIVACY NOTE: isPublic hides a node in the UI only. A public world's full
 * `data` jsonb is readable under RLS, so private content is still reachable via
 * the raw API. This matches "hide WIP sections from readers"; it is NOT hard
 * security (that would need a separate owner-only table).
 */

/* ── Per-group settings ───────────────────────────────────────── */

function renderGroupSettings(group) {
  const content = UI.get('main-content');
  content.innerHTML = '';
  if (!group) { navigate('home'); return; }

  const isMenu = group.type === 'menu';
  const hasItems = group.type === 'list' || group.type === 'graph';

  const name = UI.make('input').class('detail-name-input')
    .value(group.name || '').attrs({ placeholder: 'Group name…' });

  const intro = UI.make('textarea').class('field-input')
    .value(group.intro || '').attrs({ placeholder: 'Text shown above this group…', rows: '3' });

  const template = UI.make('textarea').class('field-input')
    .value(group.itemTemplate || '').attrs({ placeholder: '# {{name}}\n\nDefault body for each new entry…', rows: '5' });

  const publicToggle = UI.make('input').ofType('checkbox')
    .execute(el => { el.checked = group.isPublic !== false; });
  const visRow = UI.make('label').class('switch-row').withChilds(
    publicToggle,
    UI.make('span').text('Public — visible to anyone viewing this world')
  );

  // Parent menu: any menu node that isn't this node or one of its descendants.
  const blocked = new Set(groupDescendantSlugs(group.slug));
  const menus = (State.data.groups || []).filter(g => g.type === 'menu' && !blocked.has(g.slug));
  const parentSel = UI.make('select').class('field-input').execute(sel => {
    sel.appendChild(new Option('— Top level —', ''));
    menus.forEach(m => sel.appendChild(new Option(m.name, m.slug)));
    sel.value = group.parentId || '';
  });
  const parentField = UI.make('div').class('field-group')
    .withChilds(UI.make('label').text('Inside menu'), parentSel);
  if (!menus.length)
    parentField.withChilds(UI.make('p').class('item-meta')
      .text('No menu folders yet — create a “Menu — folder” group (New group, or the button in Edit index) to nest groups.'));

  function save() {
    const n = name.getElement().value.trim();
    if (!n) { alert('Name is required'); return; }
    group.name = n;
    group.isPublic = publicToggle.getElement().checked;
    group.parentId = parentSel.getElement().value || null;
    if (!isMenu) group.intro = intro.getElement().value;
    if (hasItems) group.itemTemplate = template.getElement().value;
    saveData();
    buildSidebar();
    navigate(group.slug);
  }

  const bar = UI.make('div').class('detail-bar').withChilds(
    UI.make('button').class('btn-secondary').innerHTML(Icons.label('back', 'Back'))
      .on('click', () => navigate(isMenu ? 'home' : group.slug)),
    UI.make('button').class('btn-primary').text('Save').on('click', save)
  );

  const wrap = UI.make('div').class('detail-view').withChilds(
    bar,
    UI.make('h1').class('detail-title').text('Group settings'),
    name,
    UI.make('div').class('field-group').style({ marginTop: '16px' })
      .withChilds(UI.make('label').text('Visibility'), visRow),
    parentField
  );

  if (!isMenu)
    wrap.withChilds(UI.make('div').class('field-group')
      .withChilds(UI.make('label').text('Intro text (shown above the group)'), intro));
  if (hasItems)
    wrap.withChilds(UI.make('div').class('field-group')
      .withChilds(UI.make('label').text('New-item template (pre-fills each new entry)'), template));

  // Reference token the writer can drop into any markdown body.
  const token = `#${group.name}:${group.slug}#`;
  wrap.withChilds(
    UI.make('div').class('field-group').withChilds(
      UI.make('label').text('Reference this group'),
      UI.make('input').class('field-input').attrs({ readonly: 'readonly', value: token })
        .on('focus', e => e.target.select())
    )
  );

  // Danger zone — delete (children, if any, are lifted to this node's parent).
  wrap.withChilds(
    UI.make('div').style({ marginTop: '24px', borderTop: '1px solid var(--border)', paddingTop: '16px' }).withChilds(
      UI.make('button').class('btn-danger').innerHTML(Icons.label('trash', 'Delete group'))
        .on('click', () => _deleteGroup(group))
    )
  );

  content.appendChild(wrap.getElement());
  name.getElement().focus();
}

function _deleteGroup(group) {
  const kids = groupChildren(group.slug);
  const msg = kids.length
    ? `Delete "${group.name}"? Its ${kids.length} child item(s) will move up one level.`
    : `Delete "${group.name}"?`;
  if (!confirm(msg)) return;
  kids.forEach(c => { c.parentId = group.parentId || null; });
  const i = State.data.groups.indexOf(group);
  if (i !== -1) State.data.groups.splice(i, 1);
  saveData();
  buildSidebar();
  navigate('home');
}

