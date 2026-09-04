/**
 * Granular "new content" tracking.
 *
 * Author side: each editable element carries an `updatedAt` ISO stamp, written
 * when it's saved. saveWorld() also rolls these up into worlds.element_updates
 * (a small { key: ISO } map) so the feed can tell a world has unseen changes
 * without fetching the whole data blob.
 *
 * Viewer side: per-user "seen" timestamps live in localStorage, keyed by world
 * + element, and are written when the viewer LEAVES an element (not on enter).
 *
 * A world stays "new" until every updated element has been seen.
 */

function nowISO() { return new Date().toISOString(); }

/* ── Element keys ── */
const EL_HOME = 'home';
function elKeyText(slug)    { return 'group:' + slug; }
function elKeyItem(slug, id) { return 'item:' + slug + ':' + id; }

// Roll a world's data blob up into { elementKey: updatedAt }.
function collectElementUpdates(data) {
  const map = {};
  if (!data) return map;
  if (data.home && data.home.updatedAt) map[EL_HOME] = data.home.updatedAt;
  (data.groups || []).forEach(g => {
    if (g.type === 'text') { if (g.updatedAt) map[elKeyText(g.slug)] = g.updatedAt; }
    else (g.items || []).forEach(it => { if (it.updatedAt && it.id) map[elKeyItem(g.slug, it.id)] = it.updatedAt; });
  });
  return map;
}

/* ── Per-user seen store (localStorage) ── */
function _seenStoreKey() { return 'wb:seen:' + (window.Auth?.getUser()?.id || ''); }
function _loadSeen() { try { return JSON.parse(localStorage.getItem(_seenStoreKey()) || '{}'); } catch { return {}; } }
function _saveSeen(m) { try { localStorage.setItem(_seenStoreKey(), JSON.stringify(m)); } catch (e) { console.error(e); } }

function markElementSeen(worldId, key) {
  if (!worldId || !key) return;
  const m = _loadSeen();
  (m[worldId] = m[worldId] || {})[key] = nowISO();
  _saveSeen(m);
  // Mirror to the cloud so the "visited" state follows the user across devices.
  // Fire-and-forget: a blocked/failed write degrades to today's local-only behaviour.
  window.Cloud?.saveSeen?.(worldId, m[worldId]).catch?.(e => console.error('saveSeen', e));
}

// Pull the cloud seen-map for a world and merge it into the local cache, keeping
// the LATER ISO per element so neither device clobbers the other. Call on open.
async function syncSeenFromCloud(worldId) {
  if (!worldId || !window.Cloud?.loadSeen) return;
  let remote;
  try { remote = await Cloud.loadSeen(worldId); }
  catch (e) { console.error('loadSeen', e); return; }
  if (!remote || !Object.keys(remote).length) return;
  const m = _loadSeen();
  const local = (m[worldId] = m[worldId] || {});
  let changed = false;
  for (const k in remote) {
    if (!local[k] || local[k] < remote[k]) { local[k] = remote[k]; changed = true; }
  }
  if (changed) _saveSeen(m);
}

function _seenAt(worldId, key) {
  const w = _loadSeen()[worldId];
  return (w && w[key]) || null;
}

// Has `key` been updated more recently than it was last seen?
function isElementUnseen(worldId, key, updatedAt) {
  if (!updatedAt) return false;
  const s = _seenAt(worldId, key);
  return !s || s < updatedAt;
}

// Does a world have ANY unseen updated element? `updates` = element_updates map.
function worldHasUnseen(worldId, updates) {
  if (!updates) return false;
  return Object.keys(updates).some(k => isElementUnseen(worldId, k, updates[k]));
}

// Feed-level check: a world is "new" for the viewer only if they don't own it.
function feedWorldUnseen(world) {
  const uid = window.Auth?.getUser()?.id;
  if (!world || world.owner_id === uid) return false;
  return worldHasUnseen(world.id, world.element_updates);
}

/* ── Helpers for the currently-open world (uses State.data) ── */

function homeHasUnseen() {
  const wid = State.currentWorld?.id;
  if (!wid || isOwner()) return false;   // your own world is never "new" to you
  return isElementUnseen(wid, EL_HOME, State.data?.home?.updatedAt);
}

function groupHasUnseen(group) {
  const wid = State.currentWorld?.id;
  if (!wid || isOwner()) return false;
  if (group.type === 'text') return isElementUnseen(wid, elKeyText(group.slug), group.updatedAt);
  return (group.items || []).some(it => it.id && isElementUnseen(wid, elKeyItem(group.slug, it.id), it.updatedAt));
}

function itemIsUnseen(groupSlug, item) {
  const wid = State.currentWorld?.id;
  if (!wid || isOwner()) return false;
  return !!item.id && isElementUnseen(wid, elKeyItem(groupSlug, item.id), item.updatedAt);
}

/* ── Mark-on-leave ── */

// The element key the viewer is currently looking at, or null.
function currentElementKey() {
  if (!State.currentWorld) return null;
  if (State.currentItem) {
    const { groupSlug, itemIndex } = State.currentItem;
    if (itemIndex == null) return null;            // a new, unsaved item
    const it = getGroup(groupSlug)?.items[itemIndex];
    return it && it.id ? elKeyItem(groupSlug, it.id) : null;
  }
  if (State.currentView === EL_HOME) return EL_HOME;
  const g = getGroup(State.currentView);
  if (g && g.type === 'text') return elKeyText(g.slug);
  return null;                                       // list/graph overviews aren't elements
}

// Mark the element being left as seen. Call before any view transition.
function leaveCurrentElement() {
  const k = currentElementKey();
  if (k && State.currentWorld) markElementSeen(State.currentWorld.id, k);
}
