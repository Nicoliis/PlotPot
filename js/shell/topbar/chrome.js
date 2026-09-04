/* ── Topbar chrome: path label + which controls are visible ───── */

function _chrome() {
  document.body.classList.remove('sidebar-open'); // close the mobile drawer on any navigation
  const inWorld = !!State.currentWorld;
  const owner   = isOwner();
  const show = (id, on) => { const el = UI.get(id); if (el) el.style.display = on ? '' : 'none'; };

  // Two distinct shells: a "social" space (gallery/profile) and an immersive
  // "world" space (reading/editing). CSS keys off these body classes.
  document.body.classList.toggle('mode-world', inWorld);
  document.body.classList.toggle('mode-social', !inWorld);

  show('breadcrumb',      inWorld);
  show('search-input',    inWorld);
  show('mode-toggle',     inWorld && owner);
  show('world-menu-wrap', inWorld);
  show('btn-world-settings', owner);  // items inside the world-actions menu
  show('btn-import',         owner);  // export stays available to viewers
  show('btn-new-group',   inWorld && owner && State.editMode);

  _syncModeToggle();
  _renderUserMenu();
  _setBreadcrumb();
}

function _setBreadcrumb() {
  const el = UI.get('breadcrumb');
  if (!el) return;
  let path;
  if (!State.currentWorld) {
    path = State.currentView === 'profile'   ? 'Profile'
         : State.currentView === 'new-world' ? 'New World' : 'Gallery';
  } else {
    path = State.currentWorld.title || 'World';
    const group = getGroup(State.currentView);
    const sub = State.currentView === 'home'           ? 'Home'
              : State.currentView === 'new-group'      ? 'New Group'
              : State.currentView === 'world-settings' ? 'Settings'
              : State.currentView === 'index-editor'   ? 'Edit index'
              : State.currentView === 'group-settings' ? ((getGroup(State.settingsSlug)?.name || 'Group') + '  ›  Settings')
              : (group?.name || State.currentView);
    path += '  ›  ' + sub;
    if (State.currentItem) {
      const { groupSlug, itemIndex } = State.currentItem;
      const item = itemIndex !== null ? getGroup(groupSlug)?.items[itemIndex] : null;
      path += '  ›  ' + (item?.name || 'New Item');
    }
  }
  el.textContent = path;
}
