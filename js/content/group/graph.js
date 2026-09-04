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

  // Chronological list (topologically sorted) — cards, or every beat in full.
  // `sorted` is already [{ item, i, level }], which is exactly the entry shape
  // groupItemsEl wants, so the topological order carries over untouched.
  // Dragging can only reorder beats within a level: Array.sort is stable, so
  // array order is the tie-break, and a cross-level drop would be a no-op.
  const chrono = groupItemsEl(group, sorted, 'Beat', (from, to) => from.level === to.level);

  // DAG visualisation
  const dagWrap = UI.make('div').class('dag-view');
  if (group.items.length)
    dagWrap.getElement().appendChild(_buildDAG(group, levels, backEdges));
  else
    dagWrap.withChilds(UI.make('p').style({ color: 'var(--text-muted)' }).text('No beats yet.'));

  wrap.withChilds(
    UI.make('div').class('graph-columns').withChilds(
      UI.make('div').withChilds(UI.make('h3').text('Graph'), dagWrap),
      UI.make('div').withChilds(UI.make('h3').text('Chronology'), chrono),
    )
  );
  content.appendChild(wrap.getElement());
}
