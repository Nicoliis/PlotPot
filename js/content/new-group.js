function renderNewGroupView() {
  const content = UI.get('main-content');
  content.innerHTML = '';

  let groupType = 'list';

  const nameInput = UI.make('input').class('detail-name-input')
    .attrs({ placeholder: 'Group name…' });

  const btnList  = UI.make('button').class('btn-primary').text('List — card grid');
  const btnGraph = UI.make('button').class('btn-secondary').text('Graph — DAG / timeline');
  const btnText  = UI.make('button').class('btn-secondary').text('Text — free writing');
  const btnMenu  = UI.make('button').class('btn-secondary').text('Menu — folder');

  function setType(t) {
    groupType = t;
    btnList.getElement().className  = t === 'list'  ? 'btn-primary' : 'btn-secondary';
    btnGraph.getElement().className = t === 'graph' ? 'btn-primary' : 'btn-secondary';
    btnText.getElement().className  = t === 'text'  ? 'btn-primary' : 'btn-secondary';
    btnMenu.getElement().className  = t === 'menu'  ? 'btn-primary' : 'btn-secondary';
  }
  btnList.on('click',  () => setType('list'));
  btnGraph.on('click', () => setType('graph'));
  btnText.on('click',  () => setType('text'));
  btnMenu.on('click',  () => setType('menu'));

  function create() {
    const name = (nameInput.getElement().value || '').trim();
    if (!name) { alert('Name is required'); return; }
    const slug = slugify(name);
    if (getGroup(slug)) { alert('"' + name + '" already exists.'); return; }
    const group = groupType === 'text' ? { name, slug, type: 'text', content: '' }
                : groupType === 'menu' ? { name, slug, type: 'menu' }
                : { name, slug, type: groupType, items: [] };
    State.data.groups.push(group);
    saveData();
    buildSidebar();
    navigate(slug);
  }

  nameInput.on('keydown', e => { if (e.key === 'Enter') create(); });

  const wrap = UI.make('div').class('detail-view').withChilds(
    UI.make('div').class('detail-bar').withChilds(
      UI.make('button').class('btn-secondary').innerHTML(Icons.label('back', 'Back')).on('click', () => navigate('home')),
      UI.make('button').class('btn-primary').text('Create').on('click', create)
    ),
    nameInput,
    UI.make('div').class('field-group').withChilds(
      UI.make('label').text('Type'),
      UI.make('div').style({ display: 'flex', gap: '10px', marginTop: '8px', flexWrap: 'wrap' })
        .withChilds(btnList, btnGraph, btnText, btnMenu)
    )
  );

  content.appendChild(wrap.getElement());
  nameInput.getElement().focus();
}
