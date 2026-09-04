/* ── Shared bits used by the list/graph/text views ───────────── */

// Title row with an edit-mode "Settings" button (list/graph use this).
function groupHeader(group) {
  const row = UI.make('div').class('group-head').withChilds(UI.make('h1').text(group.name));
  if (State.editMode && isOwner()) row.withChilds(groupSettingsBtn(group));
  return row;
}

function groupSettingsBtn(group) {
  return UI.make('button').class('btn-secondary', 'btn-sm')
    .innerHTML(Icons.label('settings', 'Settings'))
    .on('click', () => openGroupSettings(group.slug));
}

// Rendered intro markdown shown above a group's body, or null when empty.
function groupIntroEl(group) {
  if (!group || !group.intro) return null;
  const el = document.createElement('div');
  el.className = 'preview-only group-intro';
  el.innerHTML = renderMarkdown(group.intro);
  bindRefLinks(el);
  return el;
}

/* ── Shared: which type icon a group uses ─────────────────────── */
function groupTypeIcon(group) {
  return group.type === 'menu'  ? 'type-menu'
       : group.type === 'graph' ? 'type-graph'
       : group.type === 'text'  ? 'type-text'
       : 'type-list';
}
