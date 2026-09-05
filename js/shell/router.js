/* ── Top-level navigation (gallery / profile / world) ─────────────
   Every entry point ends with Url.sync(), which mirrors the new State into
   the address bar so any screen can be linked to. url.js mutes that while it
   is replaying a link, so this stays a plain one-liner everywhere. */

/* Leaving the current view. Refuses when it holds an unsaved draft the user
   wants to keep; otherwise drops the guard and marks the element seen. Every
   entry point below goes through this rather than calling leaveCurrentElement
   directly, so there is one place that can say no. */
function _leaveView() {
  if (!confirmLeaveDraft()) return false;
  registerDraft(null);
  leaveCurrentElement();
  return true;
}

function goGallery() {
  if (!_leaveView()) return;
  State.currentView = 'gallery';
  State.currentWorld = null;
  State.data = null;
  State.currentItem = null;
  _chrome();
  buildSidebar();
  renderGallery();
  Url.sync();
}

function goProfile(userId) {
  if (!_leaveView()) return;
  State.currentView = 'profile';
  State.currentWorld = null;
  State.data = null;
  State.currentItem = null;
  State.profileViewing = userId || window.Auth?.getUser()?.id || null;
  _chrome();
  buildSidebar();
  renderProfile(State.profileViewing);
  Url.sync();
}

function goNewWorld() {
  if (!_leaveView()) return;
  State.currentView = 'new-world';
  State.currentWorld = null;
  State.data = null;
  State.currentItem = null;
  _chrome();
  buildSidebar();
  renderWorldForm('create');
  Url.sync();
}

// Open a world by id (always starts in view mode). Returns true on success —
// url.js needs to know whether a shared ?site=world link actually resolved.
async function openWorld(id) {
  if (!_leaveView()) return false;   // leaving whatever element was open in the previous world
  const content = UI.get('main-content');
  content.innerHTML = '<p style="color:var(--text-muted);padding:12px">Loading world…</p>';

  const world = await Cloud.getWorld(id);
  if (!world) { alert('World not found or not accessible.'); goGallery(); return false; }

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
  Url.sync();
  return true;
}

function openWorldSettings() {
  if (!isOwner()) return;
  if (!_leaveView()) return;
  State.currentView = 'world-settings';
  State.currentItem = null;
  _chrome();
  buildSidebar();
  renderWorldForm('edit');
  Url.sync();
}

/* ── Within-world navigation ──────────────────────────────────── */

function navigate(slug) {
  if (!_leaveView()) return;
  State.currentView = slug;
  State.currentItem = null;
  _chrome();
  buildSidebar();
  renderCurrentView();
  Url.sync();
}

function navigateToItem(groupSlug, itemIndex) {
  if (!_leaveView()) return;
  State.currentView = groupSlug;
  State.currentItem = { groupSlug, itemIndex };
  _chrome();
  buildSidebar();
  renderDetailView();
  Url.sync();
}

function navigateToNewItem(groupSlug) {
  navigateToItem(groupSlug, null);
}

// Owner-only: open a group's settings, or the whole-index structure editor.
function openGroupSettings(slug) {
  if (!isOwner()) return;
  if (!_leaveView()) return;
  State.settingsSlug = slug;
  State.currentView = 'group-settings';
  State.currentItem = null;
  _chrome();
  buildSidebar();
  renderGroupSettings(getGroup(slug));
  Url.sync();
}

function openIndexEditor() {
  if (!isOwner()) return;
  if (!_leaveView()) return;
  State.currentView = 'index-editor';
  State.currentItem = null;
  _chrome();
  buildSidebar();
  renderIndexEditor();
  Url.sync();
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
