function renderList(group) {
  const content = UI.get('main-content');
  content.innerHTML = '';

  const grid = UI.make('div').class('list-view');

  group.items.forEach((item, i) => {
    grid.withChilds(UI.make('div').execute(el =>
      el.appendChild(makeItemCard(item, () => navigateToItem(group.slug, i), itemIsUnseen(group.slug, item)))
    ));
  });

  if (State.editMode) {
    const singular = group.name.replace(/s$/i, '');
    grid.withChilds(
      UI.make('div').class('item-card', 'new-item-card')
        .text('+ New ' + singular)
        .on('click', () => navigateToNewItem(group.slug))
    );
  }

  if (!group.items.length && !State.editMode) {
    grid.withChilds(UI.make('p').style({ color: 'var(--text-muted)', padding: '12px' }).text('Nothing here yet.'));
  }

  const wrap = UI.make('div');
  wrap.withChilds(groupHeader(group));
  const intro = groupIntroEl(group);
  if (intro) wrap.getElement().appendChild(intro);
  wrap.withChilds(grid);
  content.appendChild(wrap.getElement());
}
