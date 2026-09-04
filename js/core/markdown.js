function renderMarkdown(text) {
  const processed = (text || '').replace(/#([^#\n]+)#/g, (_, inner) => {
    const colon = inner.indexOf(':');
    const display = colon >= 0 ? inner.slice(0, colon).trim() : inner.trim();
    const key     = colon >= 0 ? inner.slice(colon + 1).trim() : inner.trim();
    return `<a href="#" class="ref-link" data-ref="${slugify(key)}">${display}</a>`;
  });
  return marked.parse(processed);
}

function bindRefLinks(container) {
  container.querySelectorAll('.ref-link').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      navigateToRef(a.dataset.ref);
    });
  });
}

function navigateToRef(slug) {
  // A group/menu reference (key = slug) navigates to that section directly.
  const group = (State.data?.groups || []).find(g => g.slug === slug);
  if (group) { navigate(group.slug); return; }
  // Otherwise resolve an item by its slugified name.
  for (const g of (State.data?.groups || [])) {
    const idx = (g.items || []).findIndex(item => slugify(item.name) === slug);
    if (idx !== -1) { navigateToItem(g.slug, idx); return; }
  }
  alert('Reference not found: ' + slug);
}
