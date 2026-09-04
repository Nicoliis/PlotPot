function renderList(group) {
  const content = UI.get('main-content');
  content.innerHTML = '';

  const wrap = UI.make('div');
  wrap.withChilds(groupHeader(group));
  const intro = groupIntroEl(group);
  if (intro) wrap.getElement().appendChild(intro);

  // Cards or the expanded read — the viewer picks (js/content/group/items.js).
  // Array order is the display order, which is what makes it drag-sortable.
  wrap.withChilds(groupItemsEl(
    group,
    group.items.map((item, i) => ({ item, i })),
    group.name.replace(/s$/i, '')
  ));

  content.appendChild(wrap.getElement());
}
