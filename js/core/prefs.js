/**
 * Viewer-side display preferences (localStorage).
 *
 * Sibling of seen.js: both remember something about the READER rather than the
 * world, so neither ever touches the data blob or Supabase. They differ in
 * scope, and that difference drives the design — a "seen" stamp is about a
 * PERSON, so seen.js is user-keyed and mirrored to the cloud to follow them
 * across devices. How wide you like your reading column is about the BROWSER
 * you happen to be sitting at, so this store is not user-keyed and never
 * syncs: it works signed out, survives sign-out, and a shared link can't drag
 * someone else's preference along.
 *
 * Shape, nested world → group so one world can't inflate the others:
 *   { "<worldId>": { "<groupSlug>": "expanded" } }
 *
 * Only NON-default values are stored, and switching back to the default
 * deletes the entry. That keeps the blob small and — the real reason — leaves
 * the default itself changeable later, instead of pinning every existing
 * reader to today's choice.
 */

const VIEW_CARDS    = 'cards';      // default: a grid of clickable summary cards
const VIEW_EXPANDED = 'expanded';   // every entry inline, in full

const VIEW_MODE_KEY = 'pp:view-mode';   // 'pp:' like url.js; 'wb:' is seen.js's legacy prefix

function _loadViewModes() {
  try { return JSON.parse(localStorage.getItem(VIEW_MODE_KEY) || '{}'); } catch { return {}; }
}
function _saveViewModes(m) {
  try { localStorage.setItem(VIEW_MODE_KEY, JSON.stringify(m)); } catch (e) { console.error(e); }
}

// How the open world's `slug` group wants to be rendered. Anything unknown — a
// hand-edited store, a mode we later drop, no world open — degrades to cards,
// so a bad value can never blank a group.
function groupViewMode(slug) {
  const wid = State.currentWorld?.id;
  if (!wid || !slug) return VIEW_CARDS;
  return _loadViewModes()[wid]?.[slug] === VIEW_EXPANDED ? VIEW_EXPANDED : VIEW_CARDS;
}

function setGroupViewMode(slug, mode) {
  const wid = State.currentWorld?.id;
  if (!wid || !slug) return;
  const m = _loadViewModes();
  const w = m[wid] || {};
  if (mode === VIEW_CARDS) delete w[slug];        // the default is stored as absence
  else                     w[slug] = mode;
  if (Object.keys(w).length) m[wid] = w; else delete m[wid];
  _saveViewModes(m);
}
