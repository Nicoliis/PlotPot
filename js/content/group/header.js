/* ── Shared bits used by the list/graph/text views ───────────── */

// Title row with the Cards/Expanded toggle and an edit-mode "Settings" button
// (list/graph use this; text and menu build their own bars).
function groupHeader(group) {
  const row = UI.make('div').class('group-head').withChilds(UI.make('h1').text(group.name));
  // Everything on the right end goes in one box, so .group-head's
  // space-between keeps the title left and the controls right once there are two.
  const actions = UI.make('div').class('group-head-actions');
  if (group.type === 'list' || group.type === 'graph') actions.withChilds(groupViewToggle(group));
  if (State.editMode && isOwner()) actions.withChilds(groupSettingsBtn(group));
  return row.withChilds(actions);
}

function groupSettingsBtn(group) {
  return UI.make('button').class('btn-secondary', 'btn-sm')
    .innerHTML(Icons.label('settings', 'Settings'))
    .on('click', () => openGroupSettings(group.slug));
}

// Cards ⇄ Expanded. A VIEWER-side choice (js/core/prefs.js), not part of the
// world: every reader gets it, owner or not, in view mode or edit mode, and it
// never reaches Supabase. Only the two types that render a collection of items
// get it — a text or menu group has nothing to expand.
function groupViewToggle(group) {
  const mode = groupViewMode(group.slug);
  const seg = UI.make('div').class('seg');
  [[VIEW_CARDS, 'Cards', 'gallery'], [VIEW_EXPANDED, 'Expanded', 'type-text']].forEach(([m, label, icon]) =>
    seg.withChilds(
      UI.make('button').class('seg-btn', m === mode ? 'seg-btn--on' : '')
        .attrs({ type: 'button', title: label + ' view' })
        .innerHTML(Icons.label(icon, label))
        .on('click', () => _setGroupView(group, m))
    )
  );
  return seg;
}

// Mirrors _setEditMode() in shell/topbar/mode-toggle.js: persist, then
// re-render through the router so the layout branch lives in one place.
function _setGroupView(group, mode) {
  if (groupViewMode(group.slug) === mode) return;
  setGroupViewMode(group.slug, mode);
  renderCurrentView();
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
