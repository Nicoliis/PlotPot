const DEFAULT_GROUPS = [
  { name: 'Characters',  slug: 'characters',  type: 'list',  items: [] },
  { name: 'Locations',   slug: 'locations',   type: 'list',  items: [] },
  { name: 'Story Beats', slug: 'storybeats',  type: 'graph', items: [] },
];

const State = {
  profile: null,        // the signed-in user's profile row
  worlds: [],           // gallery cache (metadata only)
  currentWorld: null,   // full world row currently open: { id, owner_id, title, tags, is_public, data, author }
  data: null,           // === currentWorld.data while inside a world (home + groups); null in the gallery
  profileViewing: null, // user id whose profile is being shown
  following: { worlds: new Set(), users: new Set() }, // viewer's follows
  likes: new Set(),      // world ids the viewer liked
  homeTab: 'following',  // 'following' | 'discover' | 'mine'
  currentView: 'gallery',
  currentItem: null,    // { groupSlug, itemIndex } or null
  settingsSlug: null,   // group whose settings view is open (currentView==='group-settings')
  editMode: false,      // view-first; only owners can toggle on
};
