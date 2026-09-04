function renderTextGroup(group) {
  const content = UI.get('main-content');
  content.innerHTML = '';
  let textValue = group.content || '';

  const wrap = UI.make('div').class('detail-view');

  const backBtn = UI.make('button').class('btn-secondary').innerHTML(Icons.label('back', 'Back')).on('click', () => navigate('home'));
  const bar = UI.make('div').class('detail-bar').withChilds(backBtn);

  if (State.editMode) {
    bar.withChilds(
      groupSettingsBtn(group),
      UI.make('button').class('btn-primary').text('Save')
        .on('click', () => { group.content = textValue; group.updatedAt = nowISO(); saveData(); })
    );
  }

  wrap.withChilds(
    bar,
    UI.make('h1').class('detail-title').text(group.name)
  );
  const intro = groupIntroEl(group);
  if (intro) wrap.getElement().appendChild(intro);
  wrap.withChilds(UI.make('div').execute(el =>
    el.appendChild(makeMdPanel(textValue, val => { textValue = val; }))
  ));

  content.appendChild(wrap.getElement());
}
