/* Follow toggle buttons for worlds and people. Optimistic; reflects State.following. */

function _paintFollow(btn, on, kind) {
  const el = btn.getElement ? btn.getElement() : btn;
  el.classList.toggle('follow-btn--on', on);
  if (kind === 'world') {
    el.innerHTML = Icons.label(on ? 'bookmarkOn' : 'bookmark', on ? 'Following' : 'Follow');
  } else {
    el.innerHTML = Icons.label(on ? 'userCheck' : 'userPlus', on ? 'Following' : 'Follow');
  }
}

// Follow/unfollow a world.
function followWorldButton(worldId) {
  const on = State.following.worlds.has(worldId);
  const btn = UI.make('button').class('follow-btn').on('click', async e => {
    e.stopPropagation();
    const next = !State.following.worlds.has(worldId);
    if (next) State.following.worlds.add(worldId); else State.following.worlds.delete(worldId);
    _paintFollow(btn, next, 'world');
    try { await Cloud.followWorld(worldId, next); } catch (err) { console.error(err); }
  });
  _paintFollow(btn, on, 'world');
  return btn;
}

// Like / unlike a world; shows the running count.
function _paintLike(btn, on, n) {
  const el = btn.getElement ? btn.getElement() : btn;
  el.classList.toggle('like-btn--on', on);
  el.innerHTML = Icons.label(on ? 'heartOn' : 'heart', String(n));
}

function likeButton(worldId, count = 0) {
  let n = count;
  const btn = UI.make('button').class('like-btn').on('click', async e => {
    e.stopPropagation();
    const next = !State.likes.has(worldId);
    if (next) { State.likes.add(worldId); n++; } else { State.likes.delete(worldId); n = Math.max(0, n - 1); }
    _paintLike(btn, next, n);
    try { await Cloud.likeWorld(worldId, next); } catch (err) { console.error(err); }
  });
  _paintLike(btn, State.likes.has(worldId), n);
  return btn;
}

// Follow/unfollow a person. Returns null when it's the viewer themselves.
function followUserButton(userId) {
  if (!userId || userId === window.Auth?.getUser()?.id) return null;
  const on = State.following.users.has(userId);
  const btn = UI.make('button').class('follow-btn').on('click', async e => {
    e.stopPropagation();
    const next = !State.following.users.has(userId);
    if (next) State.following.users.add(userId); else State.following.users.delete(userId);
    _paintFollow(btn, next, 'user');
    try { await Cloud.followUser(userId, next); } catch (err) { console.error(err); }
  });
  _paintFollow(btn, on, 'user');
  return btn;
}
