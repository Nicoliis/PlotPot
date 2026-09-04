/* Avatar + name dropdown at the far right of the topbar. */

// Fill the avatar + name in the user menu from the loaded profile.
function _renderUserMenu() {
  const p = State.profile;
  const user = window.Auth?.getUser();
  const name = p?.display_name || p?.username || user?.email?.split('@')[0] || 'Me';
  const nm = UI.get('user-name');
  const av = UI.get('user-avatar');
  if (nm) nm.textContent = name;
  if (av) {
    if (p?.avatar_url) {
      av.className = 'avatar';
      av.textContent = '';
      av.style.backgroundImage = `url("${p.avatar_url}")`;
      av.style.backgroundSize = 'cover';
      av.style.backgroundPosition = 'center';
    } else {
      av.className = 'avatar avatar--initial';
      av.style.backgroundImage = '';
      av.textContent = (name[0] || '?').toUpperCase();
    }
  }
}

function _wireUserMenu() {
  UI.get('btn-profile').addEventListener('click', () => goProfile());
  UI.get('btn-signout').addEventListener('click', () => Auth.signOut());
}
