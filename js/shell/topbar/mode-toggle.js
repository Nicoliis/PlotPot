/* View / Edit segmented control, right of the search box. Owner-only —
   _chrome() hides it for everyone else. */

function _syncModeToggle() {
  const v = UI.get('mode-view'), e = UI.get('mode-edit');
  if (!v || !e) return;
  v.classList.toggle('seg-btn--on', !State.editMode);
  e.classList.toggle('seg-btn--on',  State.editMode);
}

function _setEditMode(on) {
  if (!isOwner() || State.editMode === on) return;
  State.editMode = on;
  _chrome();
  buildSidebar();
  renderCurrentView();
}

function _wireModeToggle() {
  UI.get('mode-view').addEventListener('click', () => _setEditMode(false));
  UI.get('mode-edit').addEventListener('click', () => _setEditMode(true));
}
