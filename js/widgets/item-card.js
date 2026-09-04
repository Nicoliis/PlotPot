function makeItemCard(item, onClick, isNew) {
  const card = UI.make('div').class('item-card').on('click', onClick);
  if (isNew) card.withChilds(UI.make('span').class('card-new').text('new'));
  card.withChilds(UI.make('div').class('item-name').text(item.name));

  if (item.content) {
    card.withChilds(
      UI.make('div').class('item-preview').text(item.content.replace(/[#*_`>\-]/g, '').substring(0, 130))
    );
  }

  if (item.parents && item.parents.length) {
    card.withChilds(
      UI.make('div').class('item-meta').text('↳ ' + item.parents.join(', '))
    );
  }

  if (item.references && item.references.length) {
    const refs = UI.make('div').class('ref-tags').style({ marginTop: '10px' });
    item.references.forEach(r =>
      refs.withChilds(UI.make('span').class('ref-tag').text(refDisplay(r)))
    );
    card.withChilds(refs);
  }

  return card.getElement();
}
