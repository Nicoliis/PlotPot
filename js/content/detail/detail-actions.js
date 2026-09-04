// Shared mutable state written by renderDetailView, read by the action handlers.
// Must be var (not let/const) so they land on window and are visible to detail.js.
var _detailMd      = '';
var _detailRefs    = null;
var _detailParents = null;

function _saveDetail() {
  const name = (UI.get('detail-name')?.value || '').trim();
  if (!name) { alert('Name is required'); return; }

  const { groupSlug, itemIndex } = State.currentItem;
  const group = getGroup(groupSlug);
  const isNew = itemIndex === null;
  const item  = isNew ? { id: generateId() } : group.items[itemIndex];

  item.name       = name;
  item.content    = _detailMd;
  item.references = _detailRefs ? _detailRefs.getRefs() : (item.references || []);

  if (group.type === 'graph')
    item.parents = _detailParents ? _detailParents.getParents() : (item.parents || []);

  item.updatedAt = nowISO();   // stamp for granular "new" tracking
  if (isNew) group.items.push(item);
  saveData();
  navigate(groupSlug);
}

function _deleteDetail() {
  const { groupSlug, itemIndex } = State.currentItem;
  const group = getGroup(groupSlug);
  if (!confirm('Delete "' + group.items[itemIndex].name + '"?')) return;
  group.items.splice(itemIndex, 1);
  saveData();
  navigate(groupSlug);
}
