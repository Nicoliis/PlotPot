/**
 * Shareable URLs on a static host ("fake" routing).
 *
 * GitHub Pages serves one file and knows nothing about our screens, so there
 * are no real paths to route on — /characters/aria would simply 404. Instead
 * the whole route lives in the query string, which any static host hands back
 * untouched:
 *
 *   ?                                                  the gallery (default)
 *   ?site=profile&id=<userId>                          an author's profile
 *   ?site=new-world                                    the create-a-world form
 *   ?site=world&id=<worldId>                           a world's home page
 *   ?site=world&id=<worldId>&g=<groupSlug>             a group inside it
 *   ?site=world&id=<worldId>&g=<groupSlug>&card=<card> one card in that group
 *
 * `card` is the item's stable id; items created before ids existed fall back to
 * a slug of their name, so old links keep resolving.
 *
 * Two directions, deliberately kept apart:
 *   sync()  — State → address bar. Every navigation in router.js ends with it.
 *   apply() — address bar → State. First load, and Back/Forward.
 *
 * sync() is muted while apply() runs: replaying a URL must not push history
 * entries of its own. Anything the URL can't name (settings forms, the index
 * editor, an unsaved new item) resolves to its nearest addressable parent, and
 * apply() rewrites the bar to whatever actually ended up on screen — so a link
 * to a deleted world quietly becomes the gallery rather than lying.
 */
const Url = (() => {
  const SITES  = new Set(['gallery', 'profile', 'new-world', 'world']);
  const PARKED = 'pp:return-to';   // deep link stashed across an OAuth redirect

  let _muted = false;   // true while apply() is driving the app
  let _bound = false;   // popstate listener attached
  let _toastTimer = null;

  /* ── Parse / serialise ────────────────────────────────────── */

  // Query string → route object. An unknown site degrades to the gallery.
  function read(search) {
    const q = new URLSearchParams(search != null ? search : window.location.search);
    const site = (q.get('site') || 'gallery').toLowerCase();
    return {
      site: SITES.has(site) ? site : 'gallery',
      id:   q.get('id')   || null,
      g:    q.get('g')    || null,
      card: q.get('card') || null,
    };
  }

  // Route object → query string ('' for the gallery, which is the bare URL).
  function build(r) {
    if (!r || r.site === 'gallery') return '';
    const q = new URLSearchParams();
    q.set('site', r.site);
    if (r.id)   q.set('id', r.id);
    if (r.g)    q.set('g', r.g);
    if (r.card) q.set('card', r.card);
    return '?' + q.toString();
  }

  /* ── State → route ────────────────────────────────────────── */

  // How an item is named in a URL: its id, or (legacy items) a slug of its name.
  function _cardParam(item) {
    return item ? (item.id || slugify(item.name || '') || null) : null;
  }

  function _findItem(group, card) {
    const items = group.items || [];
    const byId = items.findIndex(it => it.id === card);
    return byId !== -1 ? byId : items.findIndex(it => slugify(it.name || '') === card);
  }

  // The route describing what's on screen right now.
  function current() {
    if (State.currentWorld) {
      const r = { site: 'world', id: State.currentWorld.id };

      // Views with no URL of their own borrow their group's, or the world's.
      const slug = State.currentItem                     ? State.currentItem.groupSlug
                 : State.currentView === 'group-settings' ? State.settingsSlug
                 : getGroup(State.currentView)            ? State.currentView
                 : null;
      if (slug) r.g = slug;

      if (State.currentItem && State.currentItem.itemIndex != null) {
        const it   = getGroup(State.currentItem.groupSlug)?.items[State.currentItem.itemIndex];
        const card = _cardParam(it);
        if (card) r.card = card;
      }
      return r;
    }
    if (State.currentView === 'profile')   return { site: 'profile', id: State.profileViewing || null };
    if (State.currentView === 'new-world') return { site: 'new-world' };
    return { site: 'gallery' };
  }

  function _write(search, push) {
    const url = search || window.location.pathname;
    if (push) window.history.pushState(null, '', url);
    else      window.history.replaceState(null, '', url);
  }

  // Called at the end of every router.js navigation.
  function sync() {
    if (_muted) return;
    const next = build(current());
    if (next === window.location.search) return;   // same screen — no new entry
    _write(next, true);
  }

  /* ── Route → State ────────────────────────────────────────── */

  async function _openRoute(r) {
    const fresh = State.currentWorld?.id !== r.id;
    if (fresh) {
      if (!await openWorld(r.id)) return;   // openWorld() already fell back to the gallery
      // openWorld() lands on Home. When the link points deeper the viewer never
      // read Home, so drop that landing before navigate()'s mark-on-leave runs.
      if (r.g) State.currentView = null;
    }
    if (!r.g) { if (!fresh) navigate('home'); return; }   // a fresh open is on Home already

    const group = getGroup(r.g);
    if (!group || !isGroupVisible(group)) { navigate('home'); return; }

    const i = r.card ? _findItem(group, r.card) : -1;
    if (i !== -1) navigateToItem(group.slug, i);
    else          navigate(group.slug);   // the group still opens if the card is gone
  }

  // Drive the app to `r`, then rewrite the bar to what we actually landed on.
  async function apply(r) {
    _muted = true;
    try {
      if (r.site === 'world' && r.id)  await _openRoute(r);
      else if (r.site === 'profile')   goProfile(r.id || undefined);
      else if (r.site === 'new-world') goNewWorld();
      else                             goGallery();
    } catch (e) {
      console.error('Could not open that link', e);
      goGallery();
    } finally {
      _muted = false;
    }
    const landed = build(current());
    if (landed !== window.location.search) _write(landed, false);
  }

  // A link parked before an OAuth redirect (see shared/auth.js). Read-once.
  function _takeParked() {
    try {
      const q = sessionStorage.getItem(PARKED);
      sessionStorage.removeItem(PARKED);
      return q || '';
    } catch { return ''; }
  }

  // Entry point from boot.js: open whatever the address bar — or a deep link
  // parked before sign-in — asks for, and follow Back/Forward from then on.
  async function start() {
    if (!_bound) {
      _bound = true;
      window.addEventListener('popstate', () => apply(read()));
    }
    const parked = _takeParked();   // always consume, so it can never go stale
    const search = /[?&]site=/.test(window.location.search) ? window.location.search : parked;
    await apply(read(search));
  }

  /* ── Sharing ──────────────────────────────────────────────── */

  // Absolute link to the current screen.
  function link() {
    return window.location.origin + window.location.pathname + build(current());
  }

  function _toast(text) {
    let el = document.getElementById('url-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'url-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // Copy the current screen's link. Falls back to a prompt where the clipboard
  // isn't available (an http:// origin, or the user denied permission).
  async function copy() {
    const url = link();
    try {
      await navigator.clipboard.writeText(url);
      _toast('Link copied');
    } catch {
      window.prompt('Copy this link:', url);
    }
  }

  return { read, build, current, sync, apply, start, link, copy };
})();

window.Url = Url;
