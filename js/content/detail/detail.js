function renderDetailView() {
  const { groupSlug, itemIndex } = State.currentItem;
  const group  = getGroup(groupSlug);
  const isNew  = itemIndex === null;
  const item   = isNew
    ? { name: '', references: [], content: group.itemTemplate || '', parents: [], date: '' }
    : group.items[itemIndex];

  _detailMd      = item.content || '';
  _detailRefs    = null;
  _detailParents = null;

  const content = UI.get('main-content');
  content.innerHTML = '';
  const wrap = UI.make('div').class('detail-view');

  // ── action bar ─────────────────────────────────────────────────
  const backBtn = UI.make('button').class('btn-secondary').innerHTML(Icons.label('back', 'Back')).on('click', () => navigate(groupSlug));
  const bar = UI.make('div').class('detail-bar').withChilds(backBtn);
  if (State.editMode) {
    const actions = UI.make('div').class('detail-actions');
    if (!isNew) actions.withChilds(UI.make('button').class('btn-danger').text('Delete').on('click', _deleteDetail));
    actions.withChilds(UI.make('button').class('btn-primary').text('Save').on('click', _saveDetail));
    bar.withChilds(actions);
  }
  wrap.withChilds(bar);

  // ── edit fields ────────────────────────────────────────────────
  if (State.editMode) {
    wrap.withChilds(
      UI.make('input').class('detail-name-input').id('detail-name')
        .value(item.name).attrs({ placeholder: 'Item name…' })
    );
    _detailRefs = makeRefEditor(item.references);
    wrap.withChilds(
      UI.make('div').class('field-group').withChilds(
        UI.make('label').text('References')
      ).execute(el => el.appendChild(_detailRefs.element))
    );
    if (group.type === 'graph') {
      _detailParents = makeParentEditor(group, itemIndex, item.parents);
      wrap.withChilds(
        UI.make('div').class('field-group').withChilds(
          UI.make('label').text('Parent Beats')
        ).execute(el => el.appendChild(_detailParents.element))
      );
    }
  } else {
    // ── view fields ───────────────────────────────────────────────
    wrap.withChilds(UI.make('h1').class('detail-title').text(item.name));
    if (item.references?.length) {
      const tags = UI.make('div').class('ref-tags').style({ marginBottom: '16px' });
      item.references.forEach(r => tags.withChilds(UI.make('span').class('ref-tag').text(refDisplay(r))));
      wrap.withChilds(tags);
    }
    if (group.type === 'graph' && item.parents?.length)
      wrap.withChilds(UI.make('p').class('item-meta').style({ marginBottom: '16px' }).text('Parents: ' + item.parents.join(', ')));
  }

  // ── markdown panel ─────────────────────────────────────────────
  wrap.withChilds(UI.make('div').execute(el =>
    el.appendChild(makeMdPanel(_detailMd, v => { _detailMd = v; }))
  ));
  content.appendChild(wrap.getElement());
}
