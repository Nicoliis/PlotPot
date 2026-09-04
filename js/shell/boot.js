/**
 * Bootstrap — the last file the loader injects.
 *
 * Every other file only declares things; this one runs. It wires the shell
 * once, then waits for auth before pulling the user's profile and landing on
 * the gallery.
 */

let _booted = false;
let _wired = false;

function _boot() {
  if (_wired) return;       // loader may call this once DOM is already ready
  _wired = true;
  _wireTopbar();
  _wireSidebar();

  // Closing/reloading while viewing an element still counts as having seen it.
  window.addEventListener('beforeunload', () => leaveCurrentElement());

  if (window.Auth) {
    Auth.onChange(async ({ user }) => {
      if (!user) { _booted = false; return; }
      if (_booted) return;
      _booted = true;
      // Never let a cloud hiccup (e.g. tables not created yet) blank the screen —
      // always land on the gallery, which surfaces its own empty/error state.
      try { State.profile = await Cloud.ensureProfile(); } catch (e) { console.error(e); }
      try { await Cloud.migrateLegacy(); } catch (e) { console.error('migrate skipped', e); }
      try { State.following = await Cloud.loadFollowing(); } catch (e) { console.error(e); }
      try { State.likes = await Cloud.loadLikes(); } catch (e) { console.error(e); }
      if (!State.following.worlds.size && !State.following.users.size) State.homeTab = 'discover';
      goGallery();
      _refreshNotifBadge();
    });
  } else {
    goGallery();
  }
}

// Scripts are injected by loader.js, so the window 'load' event may already have
// fired by the time this runs — guard on readyState.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot);
else _boot();
