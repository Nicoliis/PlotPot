/* Create a new world, or edit the open world's metadata (title, description, tags, visibility). */

function renderWorldForm(mode) {
  const content = UI.get('main-content');
  content.innerHTML = '';
  const editing = mode === 'edit';
  const w = editing ? State.currentWorld : null;

  const title = UI.make('input').class('detail-name-input')
    .value(w?.title || '').attrs({ placeholder: 'World title…' });
  const description = UI.make('textarea').class('field-input')
    .value(w?.description || '').attrs({ placeholder: 'What is this world about?', rows: '3' });
  const tags = UI.make('input').class('field-input')
    .value((w?.tags || []).join(', ')).attrs({ placeholder: 'fantasy, magic, war (comma separated)' });

  // Required language of the world's written text.
  const language = UI.make('select').class('field-input').execute(sel => {
    sel.appendChild(new Option('Select language…', ''));
    LANGUAGES.forEach(l => sel.appendChild(new Option(l.label, l.code)));
    sel.value = w?.language || '';
  });

  const publicToggle = UI.make('input').ofType('checkbox').execute(el => { el.checked = !!w?.is_public; });
  const visRow = UI.make('label').class('switch-row').withChilds(
    publicToggle,
    UI.make('span').text('Public — anyone can view this world in the gallery')
  );

  async function submit() {
    const t = title.getElement().value.trim();
    if (!t) { alert('Title is required'); return; }
    const lang = language.getElement().value;
    if (!lang) { alert('Language is required'); return; }
    const payload = {
      title: t,
      description: description.getElement().value.trim(),
      tags: parseTags(tags.getElement().value),
      language: lang,
      is_public: publicToggle.getElement().checked,
    };

    if (editing) {
      Object.assign(State.currentWorld, payload);
      await Cloud.saveWorld(State.currentWorld);
      navigate('home');
    } else {
      try {
        const created = await Cloud.createWorld(payload);
        await openWorld(created.id);
      } catch (e) { alert('Could not create world: ' + e.message); }
    }
  }

  const bar = UI.make('div').class('detail-bar').withChilds(
    UI.make('button').class('btn-secondary').innerHTML(Icons.label('back', 'Back'))
      .on('click', () => editing ? navigate('home') : goGallery()),
    UI.make('button').class('btn-primary').text(editing ? 'Save' : 'Create world').on('click', submit)
  );

  const wrap = UI.make('div').class('detail-view').withChilds(
    bar,
    title,
    UI.make('div').class('field-group').style({ marginTop: '16px' })
      .withChilds(UI.make('label').text('Description'), description),
    UI.make('div').class('field-group').withChilds(UI.make('label').text('Tags'), tags),
    UI.make('div').class('field-group').withChilds(UI.make('label').text('Language *'), language),
    UI.make('div').class('field-group').withChilds(UI.make('label').text('Visibility'), visRow)
  );

  if (editing) {
    wrap.withChilds(
      UI.make('div').style({ marginTop: '32px', borderTop: '1px solid var(--border)', paddingTop: '16px' }).withChilds(
        UI.make('button').class('btn-danger').innerHTML(Icons.label('trash', 'Delete world')).on('click', async () => {
          if (!confirm(`Delete "${State.currentWorld.title}"? This cannot be undone.`)) return;
          await Cloud.deleteWorld(State.currentWorld.id);
          goGallery();
        })
      )
    );
  }

  content.appendChild(wrap.getElement());
  title.getElement().focus();
}
