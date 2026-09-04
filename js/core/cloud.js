/**
 * Worldbuilding — cloud data layer (Supabase).
 *
 * Unlike the generic shared/storage.js (private per-user `tool_data`), the
 * social features need cross-user reads, so this talks to two dedicated tables
 * with their own RLS policies:
 *
 *   profiles(id, username, display_name, bio, avatar_url, favorite_tags[])   — public read
 *   worlds(id, owner_id, title, description, tags[], is_public, data jsonb)   — public-or-own read
 *
 * See supabase.sql for the schema. Requires shared/auth.js (window.Auth).
 */
const Cloud = (() => {
  function _db()  { return window.Auth?.getClient() ?? null; }
  function _uid() { return window.Auth?.getUser()?.id ?? null; }

  function blankWorldData() {
    return {
      home:   { content: '# New World\n\nStart building your universe here.' },
      groups: DEFAULT_GROUPS.map(g => ({ ...g, items: [] })),
    };
  }

  /* ── Profiles ─────────────────────────────────────────────── */

  // Fetch the signed-in user's profile, creating it from auth metadata if missing.
  async function ensureProfile() {
    const db = _db(); const user = window.Auth?.getUser();
    if (!db || !user) return null;

    const { data: existing } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (existing) return existing;

    const meta = user.user_metadata || {};
    const row = {
      id: user.id,
      username: meta.user_name || meta.preferred_username || (user.email || '').split('@')[0] || null,
      display_name: meta.full_name || meta.name || null,
      avatar_url: meta.avatar_url || null,
    };
    const { data, error } = await db.from('profiles').insert(row).select('*').maybeSingle();
    if (error) { console.error('ensureProfile', error); return row; }
    return data;
  }

  async function getProfile(id) {
    const db = _db(); if (!db || !id) return null;
    const { data, error } = await db.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error) { console.error('getProfile', error); return null; }
    return data;
  }

  async function saveProfile(patch) {
    const db = _db(); const uid = _uid();
    if (!db || !uid) throw new Error('Not signed in');
    const { data, error } = await db.from('profiles').update(patch).eq('id', uid).select('*').maybeSingle();
    if (error) throw error;
    return data;
  }

  /* ── Worlds ───────────────────────────────────────────────── */

  // Name the FK explicitly — worlds↔profiles now has several relationships
  // (owner_id, world_follows, world_likes), so the embed must disambiguate.
  const CARD_COLS = 'id,owner_id,title,description,tags,language,is_public,updated_at,element_updates,author:profiles!worlds_owner_id_fkey(username,display_name,avatar_url)';

  // Gallery: every public world plus the viewer's own (RLS enforces the same).
  async function listGallery() {
    const db = _db(); const uid = _uid();
    if (!db) return [];
    let q = db.from('worlds').select(CARD_COLS).order('updated_at', { ascending: false });
    q = uid ? q.or(`is_public.eq.true,owner_id.eq.${uid}`) : q.eq('is_public', true);
    const { data, error } = await q;
    if (error) { console.error('listGallery', error); return []; }
    return data || [];
  }

  // A single author's worlds. RLS hides others' private worlds automatically.
  async function listByOwner(ownerId) {
    const db = _db(); if (!db || !ownerId) return [];
    const { data, error } = await db.from('worlds').select(CARD_COLS)
      .eq('owner_id', ownerId).order('updated_at', { ascending: false });
    if (error) { console.error('listByOwner', error); return []; }
    return data || [];
  }

  async function getWorld(id) {
    const db = _db(); if (!db || !id) return null;
    const { data, error } = await db.from('worlds')
      .select('*, author:profiles!worlds_owner_id_fkey(username,display_name,avatar_url)')
      .eq('id', id).maybeSingle();
    if (error) { console.error('getWorld', error); return null; }
    return data;
  }

  async function createWorld({ title, description = '', tags = [], language = 'en', is_public = false, data }) {
    const db = _db(); const uid = _uid();
    if (!db || !uid) throw new Error('Not signed in');
    // Guarantee the profile row exists first — worlds.owner_id has an FK to it.
    await ensureProfile();
    const row = { owner_id: uid, title, description, tags, language, is_public, data: data || blankWorldData() };
    const { data: created, error } = await db.from('worlds').insert(row).select('*').maybeSingle();
    if (error) throw error;
    return created;
  }

  // Persist the open world (content edits + metadata). Fire-and-forget; logs on failure.
  async function saveWorld(world) {
    const db = _db(); const uid = _uid();
    if (!db || !uid || !world?.id) return;
    const { error } = await db.from('worlds').update({
      title: world.title,
      description: world.description,
      tags: world.tags,
      language: world.language,
      is_public: world.is_public,
      data: world.data,
      element_updates: collectElementUpdates(world.data),
      updated_at: new Date().toISOString(),
    }).eq('id', world.id);
    if (error) console.error('saveWorld failed', error);
  }

  async function deleteWorld(id) {
    const db = _db(); if (!db || !id) return;
    const { error } = await db.from('worlds').delete().eq('id', id);
    if (error) console.error('deleteWorld', error);
  }

  // Tags across an author's PUBLIC worlds, ranked by use count (the "multiplier").
  async function publishedTags(ownerId) {
    const db = _db(); if (!db || !ownerId) return [];
    const { data, error } = await db.from('worlds').select('tags')
      .eq('owner_id', ownerId).eq('is_public', true);
    if (error) { console.error('publishedTags', error); return []; }
    const counts = {};
    (data || []).forEach(w => (w.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.entries(counts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  /* ── Follows ──────────────────────────────────────────────── */

  // The viewer's full follow state, loaded once at bootstrap into State.following.
  async function loadFollowing() {
    const db = _db(); const uid = _uid();
    if (!db || !uid) return { worlds: new Set(), users: new Set() };
    const [{ data: wf }, { data: uf }] = await Promise.all([
      db.from('world_follows').select('world_id').eq('follower_id', uid),
      db.from('user_follows').select('followee_id').eq('follower_id', uid),
    ]);
    return {
      worlds: new Set((wf || []).map(r => r.world_id)),
      users:  new Set((uf || []).map(r => r.followee_id)),
    };
  }

  async function followWorld(worldId, on) {
    const db = _db(); const uid = _uid();
    if (!db || !uid) return;
    if (on) await db.from('world_follows').upsert({ follower_id: uid, world_id: worldId }, { onConflict: 'follower_id,world_id' });
    else    await db.from('world_follows').delete().eq('follower_id', uid).eq('world_id', worldId);
  }

  async function followUser(userId, on) {
    const db = _db(); const uid = _uid();
    if (!db || !uid || userId === uid) return;
    if (on) await db.from('user_follows').upsert({ follower_id: uid, followee_id: userId }, { onConflict: 'follower_id,followee_id' });
    else    await db.from('user_follows').delete().eq('follower_id', uid).eq('followee_id', userId);
  }

  async function userFollowCounts(profileId) {
    const db = _db(); if (!db) return { followers: 0, following: 0 };
    const [a, b] = await Promise.all([
      db.from('user_follows').select('*', { count: 'exact', head: true }).eq('followee_id', profileId),
      db.from('user_follows').select('*', { count: 'exact', head: true }).eq('follower_id', profileId),
    ]);
    return { followers: a.count || 0, following: b.count || 0 };
  }

  async function worldFollowerCount(worldId) {
    const db = _db(); if (!db) return 0;
    const { count } = await db.from('world_follows').select('*', { count: 'exact', head: true }).eq('world_id', worldId);
    return count || 0;
  }

  /* ── Feed: updates from followed worlds + followed people ──── */

  async function feed() {
    const db = _db(); const uid = _uid();
    if (!db || !uid) return [];
    const f = State.following || await loadFollowing();
    const worldIds = [...f.worlds];
    const followeeIds = [...f.users];
    if (!worldIds.length && !followeeIds.length) return [];

    const clauses = [];
    if (worldIds.length)    clauses.push(`id.in.(${worldIds.join(',')})`);
    if (followeeIds.length) clauses.push(`and(is_public.eq.true,owner_id.in.(${followeeIds.join(',')}))`);

    const { data, error } = await db.from('worlds').select(CARD_COLS)
      .or(clauses.join(',')).order('updated_at', { ascending: false });
    if (error) { console.error('feed', error); return []; }

    const ws = new Set(worldIds), us = new Set(followeeIds);
    return (data || []).map(w => ({ ...w, _viaWorld: ws.has(w.id), _viaAuthor: us.has(w.owner_id) }));
  }

  /* ── Discovery rail ───────────────────────────────────────── */

  // Authors with public worlds you don't already follow, ranked by world count.
  async function suggestedAuthors(limit = 6) {
    const db = _db(); const uid = _uid();
    if (!db) return [];
    const { data } = await db.from('worlds')
      .select('owner_id, author:profiles!worlds_owner_id_fkey(username,display_name,avatar_url)').eq('is_public', true);
    const following = State.following?.users || new Set();
    const by = {};
    (data || []).forEach(w => {
      if (!w.owner_id || w.owner_id === uid || following.has(w.owner_id)) return;
      (by[w.owner_id] ||= { id: w.owner_id, author: w.author, count: 0 }).count++;
    });
    return Object.values(by).sort((a, b) => b.count - a.count).slice(0, limit);
  }

  async function popularTags(limit = 12) {
    const db = _db(); if (!db) return [];
    const { data } = await db.from('worlds').select('tags').eq('is_public', true);
    const c = {};
    (data || []).forEach(w => (w.tags || []).forEach(t => { c[t] = (c[t] || 0) + 1; }));
    return Object.entries(c).map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count).slice(0, limit);
  }

  /* ── Likes ────────────────────────────────────────────────── */

  async function loadLikes() {
    const db = _db(); const uid = _uid();
    if (!db || !uid) return new Set();
    const { data } = await db.from('world_likes').select('world_id').eq('user_id', uid);
    return new Set((data || []).map(r => r.world_id));
  }

  async function likeWorld(worldId, on) {
    const db = _db(); const uid = _uid();
    if (!db || !uid) return;
    if (on) await db.from('world_likes').upsert({ user_id: uid, world_id: worldId }, { onConflict: 'user_id,world_id' });
    else    await db.from('world_likes').delete().eq('user_id', uid).eq('world_id', worldId);
  }

  async function worldLikeCount(worldId) {
    const db = _db(); if (!db) return 0;
    const { count } = await db.from('world_likes').select('*', { count: 'exact', head: true }).eq('world_id', worldId);
    return count || 0;
  }

  // Like counts for many worlds at once → { worldId: count }.
  async function likeCounts(worldIds) {
    const db = _db(); const out = {};
    if (!db || !worldIds.length) return out;
    const { data } = await db.from('world_likes').select('world_id').in('world_id', worldIds);
    (data || []).forEach(r => { out[r.world_id] = (out[r.world_id] || 0) + 1; });
    return out;
  }

  /* ── Notifications ────────────────────────────────────────── */

  async function notifications(limit = 30) {
    const db = _db(); const uid = _uid();
    if (!db || !uid) return [];
    const { data, error } = await db.from('notifications')
      .select('*, actor:profiles!notifications_actor_id_fkey(username,display_name,avatar_url), world:worlds(title)')
      .eq('user_id', uid).order('created_at', { ascending: false }).limit(limit);
    if (error) { console.error('notifications', error); return []; }
    return data || [];
  }

  async function unreadCount() {
    const db = _db(); const uid = _uid();
    if (!db || !uid) return 0;
    const { count } = await db.from('notifications')
      .select('*', { count: 'exact', head: true }).eq('user_id', uid).eq('read', false);
    return count || 0;
  }

  async function markNotifRead(id) {
    const db = _db(); const uid = _uid();
    if (!db || !uid) return;
    await db.from('notifications').update({ read: true }).eq('id', id).eq('user_id', uid);
  }

  async function dismissNotif(id) {
    const db = _db(); const uid = _uid();
    if (!db || !uid) return;
    await db.from('notifications').delete().eq('id', id).eq('user_id', uid);
  }

  // Suggest a tag on someone else's world (notifies the owner via RPC).
  async function proposeTag(worldId, tag) {
    const db = _db(); if (!db) return;
    const { error } = await db.rpc('propose_tag', { p_world_id: worldId, p_tag: tag });
    if (error) throw error;
  }

  // Owner accepts a suggested tag: append it to the world's tags (deduped).
  async function addTagToWorld(worldId, tag) {
    const db = _db(); const uid = _uid();
    if (!db || !uid) return;
    const { data: w } = await db.from('worlds').select('tags').eq('id', worldId).maybeSingle();
    if (!w) return;
    const next = [...new Set([...(w.tags || []), String(tag).trim().toLowerCase()])];
    await db.from('worlds').update({ tags: next, updated_at: new Date().toISOString() }).eq('id', worldId);
  }

  /* ── Per-user "seen" state (cross-device visited tracking) ── */

  // The viewer's seen map for one world: { elementKey: ISO }. Empty if signed
  // out or the row doesn't exist yet.
  async function loadSeen(worldId) {
    const db = _db(); const uid = _uid();
    if (!db || !uid || !worldId) return {};
    const { data, error } = await db.from('element_seen')
      .select('seen').eq('user_id', uid).eq('world_id', worldId).maybeSingle();
    if (error) { console.error('loadSeen', error); return {}; }
    return (data && data.seen) || {};
  }

  // Persist the viewer's full seen map for one world (fire-and-forget upsert).
  async function saveSeen(worldId, map) {
    const db = _db(); const uid = _uid();
    if (!db || !uid || !worldId) return;
    const { error } = await db.from('element_seen')
      .upsert({ user_id: uid, world_id: worldId, seen: map || {}, updated_at: new Date().toISOString() },
              { onConflict: 'user_id,world_id' });
    if (error) console.error('saveSeen', error);
  }

  /* ── One-time migration of the legacy single world ────────── */

  // Old versions stored one world in tool_data (tool='worldbuilding', key='data').
  // If the user has no worlds yet, lift that blob into its own private world row.
  async function migrateLegacy() {
    const db = _db(); const uid = _uid();
    if (!db || !uid) return null;

    const { data: existing } = await db.from('worlds').select('id').eq('owner_id', uid).limit(1);
    if (existing && existing.length) return null;

    const { data: legacy } = await db.from('tool_data')
      .select('value').eq('user_id', uid).eq('tool', 'worldbuilding').eq('key', 'data').maybeSingle();
    if (!legacy?.value || !legacy.value.groups) return null;

    return createWorld({
      title: 'My First World',
      description: 'Migrated from your original worldbuilding data.',
      is_public: false,
      data: legacy.value,
    });
  }

  return {
    blankWorldData,
    ensureProfile, getProfile, saveProfile,
    listGallery, listByOwner, getWorld, createWorld, saveWorld, deleteWorld,
    publishedTags, migrateLegacy, loadSeen, saveSeen,
    loadFollowing, followWorld, followUser, userFollowCounts, worldFollowerCount,
    feed, suggestedAuthors, popularTags,
    loadLikes, likeWorld, worldLikeCount, likeCounts,
    notifications, unreadCount, markNotifRead, dismissNotif, proposeTag, addTagToWorld,
  };
})();

window.Cloud = Cloud;
