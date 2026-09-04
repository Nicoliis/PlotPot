// Helpers shared across views. Persistence now lives in cloud.js (per-world rows).

// Save the currently open world's content back to Supabase.
// State.data is the same object reference as State.currentWorld.data, so edits
// to groups/home are already reflected — we just push the row.
function saveData() {
  if (!State.currentWorld) return;
  State.currentWorld.data = State.data;
  Cloud.saveWorld(State.currentWorld).catch(e => console.error('Cloud save failed', e));
}

// True when the signed-in user owns the open world (gates edit mode / writes).
function isOwner() {
  const uid = window.Auth?.getUser()?.id;
  return !!(State.currentWorld && uid && State.currentWorld.owner_id === uid);
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function getGroup(slug) {
  return State.data?.groups.find(g => g.slug === slug) || null;
}

/* ── Index tree helpers (groups nest via parentId = parent menu's slug) ──
   Fields are optional/back-compat: missing parentId = top level, missing
   isPublic = public. `slug` is the immutable identity (refs/seen/routing). */

// Direct children of a node (parentSlug = null for the top level), in array order.
function groupChildren(parentSlug) {
  return (State.data?.groups || []).filter(g => (g.parentId || null) === (parentSlug || null));
}

// A node's slug plus all descendant slugs (used to prevent cyclic re-parenting).
function groupDescendantSlugs(slug) {
  const out = [slug];
  groupChildren(slug).forEach(c => out.push(...groupDescendantSlugs(c.slug)));
  return out;
}

// Depth-first walk in display order → [{ group, depth }, …].
function flattenGroupTree(parentSlug = null, depth = 0) {
  const rows = [];
  groupChildren(parentSlug).forEach(g => {
    rows.push({ group: g, depth });
    rows.push(...flattenGroupTree(g.slug, depth + 1));
  });
  return rows;
}

// Is this node visible to the current viewer? Owners see everything; others
// don't see a private node, nor anything under a private ancestor menu.
function isGroupVisible(group) {
  if (!group) return false;
  if (isOwner()) return true;
  let g = group;
  const seen = new Set();
  while (g && !seen.has(g.slug)) {
    if (g.isPublic === false) return false;
    seen.add(g.slug);
    g = g.parentId ? getGroup(g.parentId) : null;
  }
  return true;
}

// Parse a comma-separated tag string into a clean, de-duplicated array.
function parseTags(str) {
  return [...new Set((str || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean))];
}

// Languages a world's text can be written in (required category).
const LANGUAGES = [
  { code: 'en', label: 'English' },  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },   { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },{ code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' }, { code: 'zh', label: 'Chinese' },
  { code: 'ru', label: 'Russian' },  { code: 'ar', label: 'Arabic' },
  { code: 'other', label: 'Other' },
];
function languageLabel(code) { return (LANGUAGES.find(l => l.code === code) || {}).label || code || '—'; }

// "2h", "3d", "just now" — compact relative time from an ISO timestamp.
function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)     return 'just now';
  if (s < 3600)   return Math.floor(s / 60) + 'm';
  if (s < 86400)  return Math.floor(s / 3600) + 'h';
  if (s < 604800) return Math.floor(s / 86400) + 'd';
  return Math.floor(s / 604800) + 'w';
}

function refDisplay(r) { const i = r.indexOf(':'); return i >= 0 ? r.slice(0, i) : r; }
function refKey(r)     { const i = r.indexOf(':'); return i >= 0 ? r.slice(i+1) : r; }

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
