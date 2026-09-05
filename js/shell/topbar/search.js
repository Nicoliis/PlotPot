/* Search box in the topbar. Visible only inside a world (see _chrome).
   Enter jumps to the first item whose name or body contains the term. */

function _wireSearch() {
  UI.get('search-input').addEventListener('keyup', e => {
    if (e.key !== 'Enter' || !State.data) return;
    const term = e.target.value.toLowerCase().trim();
    if (!term) return;
    for (const g of State.data.groups) {
      // A private group is not searchable by anyone who could not already open
      // it. Without this, navigateToItem walks a non-owner straight into a
      // group the owner hid — the sidebar and the router both gate on exactly
      // this, search was the one path that didn't.
      if (!isGroupVisible(g)) continue;
      const idx = (g.items || []).findIndex(i =>
        i.name.toLowerCase().includes(term) || (i.content || '').toLowerCase().includes(term)
      );
      if (idx !== -1) { navigateToItem(g.slug, idx); return; }
    }
    alert('Nothing found for: ' + term);
  });
}
