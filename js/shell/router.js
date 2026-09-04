/* ── Top-level navigation (gallery / profile / world) ─────────── */

function goGallery() {
  leaveCurrentElement();
  State.currentView = 'gallery';
  State.currentWorld = null;
  State.data = null;
  State.currentItem = null;
  _chrome();
  buildSidebar();
  renderGallery();
}

function goProfile(userId) {
  leaveCurrentElement();
  State.currentView = 'profile';
  State.currentWorld = null;
  State.data = null;
  State.currentItem = null;
  State.profileViewing = userId || window.Auth?.getUser()?.id || null;
  _chrome();
  buildSidebar();
  renderProfile(State.profileViewing);
}

function goNewWorld() {
  leaveCurrentElement();
  State.currentView = 'new-world';
  State.currentWorld = null;
  State.data = null;
  State.currentItem = null;
  _chrome();
  buildSidebar();
  renderWorldForm('create');
}

// Open a world by id (always starts in view mode).
async function openWorld(id) {
  leaveCurrentElement();   // leaving whatever element was open in the previous world
  const content = UI.get('main-content');
  content.innerHTML = '<p style="color:var(--text-muted);padding:12px">Loading world…</p>';

  const world = await Cloud.getWorld(id);
  if (!world) { alert('World not found or not accessible.'); return goGallery(); }

  // Guard against an empty/legacy data blob.
  if (!world.data || !world.data.groups) world.data = Cloud.blankWorldData();

  // Pull cloud "seen" state so the new-content dots reflect visits from any device.
  await syncSeenFromCloud(world.id);

  State.currentWorld = world;
  State.data = world.data;
  State.editMode = false;
  State.currentView = 'home';
  State.currentItem = null;
  _chrome();
  buildSidebar();
  renderCurrentView();
}

function openWorldSettings() {
  if (!isOwner()) return;
  leaveCurrentElement();
  State.currentView = 'world-settings';
  State.currentItem = null;
  _chrome();
  buildSidebar();
  renderWorldForm('edit');
}

/* ── Within-world navigation ──────────────────────────────────── */

function navigate(slug) {
  leaveCurrentElement();
  State.currentView = slug;
  State.currentItem = null;
  _chrome();
  buildSidebar();
  renderCurrentView();
}

function navigateToItem(groupSlug, itemIndex) {
  leaveCurrentElement();
  State.currentView = groupSlug;
  State.currentItem = { groupSlug, itemIndex };
  _chrome();
  buildSidebar();
  renderDetailView();
}

function navigateToNewItem(groupSlug) {
  navigateToItem(groupSlug, null);
}

// Owner-only: open a group's settings, or the whole-index structure editor.
function openGroupSettings(slug) {
  if (!isOwner()) return;
  leaveCurrentElement();
  State.settingsSlug = slug;
  State.currentView = 'group-settings';
  State.currentItem = null;
  _chrome();
  buildSidebar();
  renderGroupSettings(getGroup(slug));
}

function openIndexEditor() {
  if (!isOwner()) return;
  leaveCurrentElement();
  State.currentView = 'index-editor';
  State.currentItem = null;
  _chrome();
  buildSidebar();
  renderIndexEditor();
}

/* ── Render the active within-world view ──────────────────────── */

function renderCurrentView() {
  if (State.currentView === 'world-settings') { renderWorldForm('edit'); return; }
  if (State.currentView === 'index-editor')   { renderIndexEditor(); return; }
  if (State.currentView === 'group-settings') { renderGroupSettings(getGroup(State.settingsSlug)); return; }
  if (State.currentItem) { renderDetailView(); return; }
  if (State.currentView === 'home') { renderHome(); return; }
  if (State.currentView === 'new-group') { renderNewGroupView(); return; }
  const group = getGroup(State.currentView);
  if (!group) return;
  if (group.type === 'menu')      renderMenu(group);
  else if (group.type === 'graph')renderGraph(group);
  else if (group.type === 'text') renderTextGroup(group);
  else                            renderList(group);
}
