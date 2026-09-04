/* ── Menu (folder) landing view ───────────────────────────────── */

function renderMenu(group) {
  const content = UI.get('main-content');
  content.innerHTML = '';
  const wrap = UI.make('div').class('detail-view');

  const bar = UI.make('div').class('detail-bar').withChilds(
    UI.make('button').class('btn-secondary').innerHTML(Icons.label('back', 'Back')).on('click', () => navigate('home'))
  );
  if (State.editMode)
    bar.withChilds(UI.make('button').class('btn-secondary').innerHTML(Icons.label('settings', 'Settings'))
      .on('click', () => openGroupSettings(group.slug)));
  wrap.withChilds(bar, UI.make('h1').text(group.name));

  if (group.intro) wrap.withChilds(UI.make('div').execute(el => {
    el.className = 'preview-only';
    el.innerHTML = renderMarkdown(group.intro);
    bindRefLinks(el);
  }));

  const kids = groupChildren(group.slug).filter(isGroupVisible);
  const grid = UI.make('div').class('list-view');
  if (!kids.length)
    grid.withChilds(UI.make('p').style({ color: 'var(--text-muted)', padding: '12px' }).text('This menu is empty.'));
  kids.forEach(k =>
    grid.withChilds(UI.make('div').class('item-card').withChilds(
      UI.make('span').class('ic').innerHTML(Icons.get(groupTypeIcon(k))),
      UI.make('span').text(k.name)
    ).on('click', () => navigate(k.slug)))
  );
  wrap.withChilds(grid);
  content.appendChild(wrap.getElement());
}

