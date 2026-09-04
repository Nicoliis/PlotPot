/* Home: a social landing page with Following / Discover / My Worlds tabs + a discovery rail. */

let _galleryFilter = { text: '', tag: null, lang: '' };
let _likeCounts = {};   // worldId → like count, populated per list render

async function renderGallery() {
  const content = UI.get('main-content');
  content.innerHTML = '';

  const home = UI.make('div').class('home');
  const main = UI.make('div').class('home-main');
  const rail = UI.make('div').class('home-rail');
  home.withChilds(main, rail);
  content.appendChild(home.getElement());

  _renderTabs(main);
  _renderRail(rail);
}

/* ── Tabs ─────────────────────────────────────────────────────── */

function _renderTabs(main) {
  main.getElement().innerHTML = '';
  const uid = window.Auth?.getUser()?.id;

  const tabs = UI.make('div').class('home-tabs');
  const body = UI.make('div').class('home-tabbody');

  const mk = (key, icon, text, badge) =>
    UI.make('button').class('home-tab', State.homeTab === key ? 'home-tab--on' : '')
      .innerHTML(Icons.label(icon, text) + (badge ? `<span class="tab-badge">${badge}</span>` : ''))
      .on('click', () => { State.homeTab = key; _renderTabs(main); });

  // Count of followed worlds (not your own) that still have unseen updates.
  const unread = (_feedCache || []).filter(feedWorldUnseen).length;

  const following = mk('following', 'bell', 'Following', unread || '').id('tab-following');
  tabs.withChilds(following, mk('discover', 'compass', 'Discover', ''), mk('mine', 'book', 'My Worlds', ''));
  main.withChilds(tabs, body);

  if (State.homeTab === 'following')      _renderFeed(body, uid);
  else if (State.homeTab === 'mine')      _renderMine(body, uid);
  else                                    _renderDiscover(body, uid);
}

/* ── Following feed ───────────────────────────────────────────── */

let _feedCache = null;

async function _renderFeed(body, uid) {
  const el = body.getElement();
  el.innerHTML = '<p class="muted-pad">Loading your feed…</p>';

  let items = await Cloud.feed();
  // Hide updates whose tags the user has muted.
  const muted = new Set(State.profile?.muted_tags || []);
  if (muted.size) items = items.filter(w => !(w.tags || []).some(t => muted.has(t)));
  _feedCache = items;
  _likeCounts = await Cloud.likeCounts(items.map(w => w.id));
  el.innerHTML = '';

  if (!items.length) {
    el.appendChild(UI.make('div').class('empty-state').withChilds(
      UI.make('p').text('Your feed is empty.'),
      UI.make('p').class('muted').text('Follow a world or a creator to see their updates here.'),
      UI.make('button').class('btn-primary').innerHTML(Icons.label('compass', 'Explore worlds'))
        .on('click', () => { State.homeTab = 'discover'; renderGallery(); })
    ).getElement());
    _updateFollowingBadge();
    return;
  }

  items.forEach(w => el.appendChild(_feedRow(w)));
  _updateFollowingBadge();
}

// Reflect the live unseen count on the Following tab.
function _updateFollowingBadge() {
  const tab = document.getElementById('tab-following');
  if (!tab) return;
  const n = (_feedCache || []).filter(feedWorldUnseen).length;
  let b = tab.querySelector('.tab-badge');
  if (n > 0) {
    if (!b) { b = document.createElement('span'); b.className = 'tab-badge'; tab.appendChild(b); }
    b.textContent = String(n);
  } else if (b) { b.remove(); }
}

function _feedRow(w) {
  const isNew = feedWorldUnseen(w);
  const author = w.author || {};
  const name = author.display_name || author.username || 'Unknown';

  const row = UI.make('div').class('feed-row').on('click', () => openWorld(w.id));

  // avatar
  const av = author.avatar_url
    ? UI.make('img').class('avatar').attrs({ src: author.avatar_url, alt: name })
    : UI.make('span').class('avatar', 'avatar--initial').text(name[0].toUpperCase());

  const why = w._viaWorld ? 'you follow this world' : 'you follow @' + (author.username || 'user');

  const meta = UI.make('div').class('feed-meta').withChilds(
    UI.make('div').class('feed-line1').withChilds(
      UI.make('span').class('feed-title').text(w.title),
      isNew ? UI.make('span').class('badge-new').text('new')
            : UI.make('span').class('feed-time').text('updated ' + timeAgo(w.updated_at))
    ),
    UI.make('div').class('feed-why').text(why + (isNew ? ' · ' + 'updated ' + timeAgo(w.updated_at) : ''))
  );

  if ((w.tags || []).length) {
    const tags = UI.make('div').class('world-tags');
    w.tags.slice(0, 5).forEach(t =>
      tags.withChilds(UI.make('span').class('tag-chip', 'tag-chip--mutable').withChilds(
        UI.make('span').text('#' + t),
        UI.make('button').class('tag-mute').attrs({ title: 'Hide #' + t + ' from your feed' })
          .innerHTML(Icons.get('eyeOff'))
          .on('click', e => { e.stopPropagation(); _muteTag(t); })
      )));
    meta.withChilds(tags);
  }

  row.withChilds(av, meta, likeButton(w.id, _likeCounts[w.id] || 0).class('like-btn--sm'));
  return row.getElement();
}

// Add a tag to the viewer's muted list and refresh the feed.
async function _muteTag(tag) {
  const muted = new Set(State.profile?.muted_tags || []);
  if (muted.has(tag)) return;
  muted.add(tag);
  const next = [...muted];
  if (State.profile) State.profile.muted_tags = next;
  try { await Cloud.saveProfile({ muted_tags: next }); } catch (e) { console.error(e); }
  if (State.homeTab === 'following') renderGallery();
}

/* ── Discover (all public worlds) ─────────────────────────────── */

async function _renderDiscover(body, uid) {
  const el = body.getElement();
  el.innerHTML = '<p class="muted-pad">Loading worlds…</p>';
  State.worlds = await Cloud.listGallery();
  _likeCounts = await Cloud.likeCounts(State.worlds.map(w => w.id));
  el.innerHTML = '';

  const allTags = [...new Set(State.worlds.flatMap(w => w.tags || []))].sort();
  const search = UI.make('input').class('field-input').attrs({ placeholder: 'Search worlds…' })
    .value(_galleryFilter.text)
    .on('input', e => { _galleryFilter.text = e.target.value.toLowerCase(); _fillGrid(grid, uid); });

  // language filter
  const langSel = UI.make('select').class('field-input', 'lang-select').execute(sel => {
    sel.appendChild(new Option('All languages', ''));
    LANGUAGES.forEach(l => sel.appendChild(new Option(l.label, l.code)));
    sel.value = _galleryFilter.lang;
  }).on('change', e => { _galleryFilter.lang = e.target.value; _fillGrid(grid, uid); });

  const tagBar = UI.make('div').class('tag-filter');
  const mkTag = (label, value) =>
    UI.make('span').class('tag-chip', _galleryFilter.tag === value ? 'tag-chip--on' : '')
      .text(label).on('click', () => { _galleryFilter.tag = value; _renderDiscover(body, uid); });
  tagBar.withChilds(mkTag('All', null));
  allTags.forEach(t => tagBar.withChilds(mkTag('#' + t, t)));

  const grid = UI.make('div').class('world-grid');
  body.withChilds(
    UI.make('div').class('gallery-filters').withChilds(search, langSel),
    tagBar, grid
  );
  _fillGrid(grid, uid);
}

function _fillGrid(gridBuilder, uid) {
  const el = gridBuilder.getElement();
  el.innerHTML = '';
  const worlds = State.worlds.filter(w => {
    if (_galleryFilter.tag && !(w.tags || []).includes(_galleryFilter.tag)) return false;
    if (_galleryFilter.lang && w.language !== _galleryFilter.lang) return false;
    if (_galleryFilter.text) {
      const hay = (w.title + ' ' + (w.description || '')).toLowerCase();
      if (!hay.includes(_galleryFilter.text)) return false;
    }
    return true;
  });
  if (!worlds.length) {
    el.appendChild(UI.make('p').class('muted-pad').text('No worlds match. Try a different tag or search.').getElement());
    return;
  }
  worlds.forEach(w => el.appendChild(_worldCard(w, uid)));
}

/* ── My Worlds ────────────────────────────────────────────────── */

async function _renderMine(body, uid) {
  const el = body.getElement();
  el.innerHTML = '<p class="muted-pad">Loading…</p>';
  const mine = await Cloud.listByOwner(uid);
  _likeCounts = await Cloud.likeCounts(mine.map(w => w.id));
  el.innerHTML = '';

  body.withChilds(
    UI.make('div').class('gallery-head').withChilds(
      UI.make('span').class('muted').text(mine.length + (mine.length === 1 ? ' world' : ' worlds')),
      UI.make('button').class('btn-primary').innerHTML(Icons.label('plus', 'New World')).on('click', () => goNewWorld())
    )
  );

  if (!mine.length) {
    body.withChilds(UI.make('p').class('muted-pad').text('You haven’t created any worlds yet.'));
    return;
  }
  const grid = UI.make('div').class('world-grid');
  mine.forEach(w => grid.withChilds(_worldCard(w, uid)));
  body.withChilds(grid);
}

/* ── Discovery rail ───────────────────────────────────────────── */

async function _renderRail(rail) {
  const el = rail.getElement();
  el.innerHTML = '';
  const [authors, tags] = await Promise.all([Cloud.suggestedAuthors(), Cloud.popularTags()]);

  if (authors.length) {
    const sec = UI.make('div').class('rail-section');
    sec.withChilds(UI.make('h3').text('Suggested creators'));
    authors.forEach(a => {
      const name = a.author?.display_name || a.author?.username || 'Unknown';
      const rowChildren = [
        a.author?.avatar_url
          ? UI.make('img').class('avatar').attrs({ src: a.author.avatar_url, alt: name })
          : UI.make('span').class('avatar', 'avatar--initial').text(name[0].toUpperCase()),
        UI.make('div').class('rail-person').withChilds(
          UI.make('span').class('rail-name').text(name).on('click', () => goProfile(a.id)),
          UI.make('span').class('muted').text(a.count + (a.count === 1 ? ' world' : ' worlds'))
        ),
      ];
      const fb = followUserButton(a.id);
      if (fb) { fb.class('follow-btn--sm'); rowChildren.push(fb); }
      sec.withChilds(UI.make('div').class('rail-row').withChilds(...rowChildren));
    });
    rail.withChilds(sec);
  }

  if (tags.length) {
    const sec = UI.make('div').class('rail-section');
    sec.withChilds(UI.make('h3').text('Popular tags'));
    const cloud = UI.make('div').class('world-tags');
    tags.forEach(({ tag, count }) =>
      cloud.withChilds(UI.make('span').class('tag-chip').text(`#${tag} ${count}`)
        .on('click', () => { _galleryFilter = { text: '', tag }; State.homeTab = 'discover'; renderGallery(); })));
    sec.withChilds(cloud);
    rail.withChilds(sec);
  }
}

/* ── World card (shared with profile) ─────────────────────────── */

function _worldCard(w, uid) {
  const card = UI.make('div').class('world-card').on('click', () => openWorld(w.id));

  const head = UI.make('div').class('world-card-head').withChilds(
    UI.make('h3').class('world-card-title').text(w.title)
  );
  if (w.owner_id === uid && !w.is_public) head.withChilds(UI.make('span').class('badge-private').text('Private'));
  else if (w.owner_id !== uid) { const fb = followWorldButton(w.id); fb.class('follow-btn--sm', 'follow-btn--icon'); head.withChilds(fb); }
  card.withChilds(head);

  if (w.description) card.withChilds(UI.make('p').class('item-preview').text(w.description));

  if ((w.tags || []).length) {
    const tags = UI.make('div').class('world-tags');
    w.tags.forEach(t => tags.withChilds(UI.make('span').class('tag-chip').text('#' + t)));
    card.withChilds(tags);
  }

  // footer: language label + like button
  const foot = UI.make('div').class('world-card-foot').withChilds(
    UI.make('span').class('world-lang').innerHTML(Icons.label('globe', languageLabel(w.language)))
  );
  foot.withChilds(likeButton(w.id, _likeCounts[w.id] || 0).class('like-btn--sm'));
  card.withChilds(foot);

  card.withChilds(_authorRow(w.author, w.owner_id));
  return card.getElement();
}

function _authorRow(author, ownerId) {
  const name = author?.display_name || author?.username || 'Unknown';
  const row = UI.make('div').class('author-row')
    .on('click', e => { e.stopPropagation(); goProfile(ownerId); });
  if (author?.avatar_url) {
    row.withChilds(UI.make('img').class('avatar').attrs({ src: author.avatar_url, alt: name }));
  } else {
    row.withChilds(UI.make('span').class('avatar', 'avatar--initial').text(name[0].toUpperCase()));
  }
  row.withChilds(UI.make('span').class('author-name').text(name));
  return row;
}
