function makeParentEditor(group, currentItemIndex, initialParents) {
  let selected = [...(initialParents || [])];
  const candidates = group.items
    .filter((_, i) => i !== currentItemIndex)
    .map(item => item.name);

  const tagArea  = UI.make('div').class('ref-tags');
  const input    = UI.make('input').class('ref-input').attrs({ placeholder: 'Search parent beat…' });
  const dropdown = UI.make('div').class('parent-dropdown');

  function renderTags() {
    tagArea.getElement().innerHTML = '';
    selected.forEach((name, i) =>
      tagArea.withChilds(
        UI.make('span').class('ref-tag').text(name + ' ×')
          .on('click', () => { selected.splice(i, 1); renderTags(); showDropdown(); })
      )
    );
  }

  function showDropdown() {
    const q = input.getElement().value.trim().toLowerCase();
    const matches = candidates.filter(n => !selected.includes(n) && (!q || n.toLowerCase().includes(q)));
    const dd = dropdown.getElement();
    dd.innerHTML = '';
    if (!matches.length) { dd.style.display = 'none'; return; }
    dd.style.display = 'block';
    matches.forEach(name => {
      UI.make('div').class('parent-option').text(name)
        .on('mousedown', e => {
          e.preventDefault();
          selected.push(name);
          input.getElement().value = '';
          renderTags();
          showDropdown();
        })
        .execute(el => dd.appendChild(el));
    });
  }

  input.on('input', showDropdown);
  input.on('focus', showDropdown);
  input.on('blur', () => setTimeout(() => { dropdown.getElement().style.display = 'none'; }, 150));
  input.on('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = dropdown.getElement().querySelector('.parent-option');
      if (first) first.dispatchEvent(new MouseEvent('mousedown'));
    }
    if (e.key === 'Escape') dropdown.getElement().style.display = 'none';
  });

  renderTags();
  const wrap = UI.make('div').class('parent-search-wrap').withChilds(input, dropdown);
  return {
    element: UI.make('div')
      .withChilds(tagArea, UI.make('div').class('ref-add-row').withChilds(wrap))
      .getElement(),
    getParents: () => selected,
  };
}
