/**
 * Topbar frame: the bits that aren't owned by one specific control.
 *
 * _wireTopbar() is the single entry point called from boot.js. Each topbar
 * region wires itself in its own file (mode-toggle, world-menu, user-menu,
 * search, notifications) — this file just calls them in screen order,
 * left to right.
 */

// Shared open/close behaviour for the topbar's dropdown menus.
function _wireDropdown(wrapId, btnId) {
  const wrap = UI.get(wrapId), btn = UI.get(btnId);
  if (!wrap || !btn) return;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    document.querySelectorAll('.dropdown.open').forEach(d => { if (d !== wrap) d.classList.remove('open'); });
    wrap.classList.toggle('open');
  });
}

// Hamburger + brand, on the far left of the topbar. The hamburger drives the
// mobile sidebar drawer; the backdrop that dismisses it lives in the sidebar.
function _wireBrand() {
  UI.get('brand').addEventListener('click', () => goGallery());

  UI.get('nav-toggle').addEventListener('click', e => {
    e.stopPropagation();
    document.body.classList.toggle('sidebar-open');
  });
}

function _wireTopbar() {
  Icons.apply();  // fill static [data-icon] placeholders in the topbar

  _wireBrand();          // ☰  brand  breadcrumb
  _wireSearch();         // search box
  _wireModeToggle();     // View / Edit
  _wireWorldMenu();      // ⋯  world actions
  _wireNotifBell();      // 🔔 notifications
  _wireUserMenu();       // 👤 avatar menu

  _wireDropdown('world-menu-wrap', 'world-menu-btn');
  _wireDropdown('user-menu-wrap',  'user-trigger');

  // Any click elsewhere closes open menus (menu-item clicks bubble here too).
  document.addEventListener('click', () =>
    document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open')));
}
