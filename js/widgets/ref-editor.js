/**
 * Returns { element: HTMLElement, getRefs: () => string[] }
 */
function makeRefEditor(initialRefs) {
  let refs = [...(initialRefs || [])];

  const container = UI.make('div').class('ref-add-cont');
  const tagArea   = UI.make('div').class('ref-tags');
  const input     = UI.make('input').class('ref-input').placeholder('Label  or  Label:Key…');
  const addBtn    = UI.make('button').class('btn-secondary').text('Add');

  function renderTags() {
    tagArea.getElement().innerHTML = '';
    refs.forEach((r, i) => {
      tagArea.withChilds(
        UI.make('span').class('ref-tag')
          .text(refDisplay(r) + ' ×')
          .on('click', () => { refs.splice(i, 1); renderTags(); })
      );
    });
  }

  addBtn.on('click', () => {
    const val = input.getElement().value.trim();
    if (val && !refs.includes(val)) {
      refs.push(val);
      input.getElement().value = '';
      renderTags();
    }
  });

  input.on('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addBtn.getElement().click(); } });

  renderTags();
  container.withChilds(
    UI.make('div').class('ref-add-row').withChilds(input, addBtn),
    tagArea,
  );

  return { element: container.getElement(), getRefs: () => refs };
}
