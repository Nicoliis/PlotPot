function renderGraph(group) {
  const content = UI.get('main-content');
  content.innerHTML = '';
  const wrap = UI.make('div');
  wrap.withChilds(groupHeader(group));
  const intro = groupIntroEl(group);
  if (intro) wrap.getElement().appendChild(intro);

  const { levels, backEdges } = _computeLevels(group.items);
  const sorted = group.items
    .map((item, i) => ({ item, i, level: levels[i] }))
    .sort((a, b) => a.level - b.level);

  // Chronological list (topologically sorted)
  const chronoGrid = UI.make('div').class('list-view');
  sorted.forEach(({ item, i }) =>
    chronoGrid.withChilds(UI.make('div').execute(el =>
      el.appendChild(makeItemCard(item, () => navigateToItem(group.slug, i), itemIsUnseen(group.slug, item)))
    ))
  );
  if (State.editMode)
    chronoGrid.withChilds(
      UI.make('div').class('item-card', 'new-item-card').text('+ New Beat')
        .on('click', () => navigateToNewItem(group.slug))
    );

  // DAG visualisation
  const dagWrap = UI.make('div').class('dag-view');
  if (group.items.length)
    dagWrap.getElement().appendChild(_buildDAG(group, levels, backEdges));
  else
    dagWrap.withChilds(UI.make('p').style({ color: 'var(--text-muted)' }).text('No beats yet.'));

  wrap.withChilds(
    UI.make('div').class('graph-columns').withChilds(
      UI.make('div').withChilds(UI.make('h3').text('Graph'), dagWrap),
      UI.make('div').withChilds(UI.make('h3').text('Chronology'), chronoGrid),
    )
  );
  content.appendChild(wrap.getElement());
}
