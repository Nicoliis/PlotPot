/**
 * Script loader. Keeps index.html to a single <script> tag and centralises
 * cache-busting: bump VERSION here and every app file is re-fetched.
 *
 * Files are injected with async=false so they execute in listed order. Only
 * boot.js actually runs anything on load — everything above it just declares
 * functions — so boot.js must stay last. The rest is grouped by where it
 * shows up on screen:
 *
 *   ┌──────────┬────────────────────────────────────────────┐
 *   │ sidebar/ │ topbar/                                    │
 *   │  logo    │  ☰ brand breadcrumb search │ View/Edit ⋯🔔👤│
 *   │  menu    ├────────────────────────────────────────────┤
 *   │  +group  │ content/                                   │
 *   │          │   gallery · profile · home · group · detail│
 *   └──────────┴────────────────────────────────────────────┘
 */
(function () {
  const VERSION = '28';

  const FILES = [
    /* vendor */
    'lib/marked.min.js',
    'lib/UI.js',

    /* core — model, services and utilities; no screen position */
    'js/core/state.js',
    'js/core/data.js',
    'js/core/cloud.js',
    'js/core/prefs.js',
    'js/core/seen.js',
    'js/core/icons.js',
    'js/core/markdown.js',
    'js/core/xml.js',
    'js/core/selftest.js',      /* ?debug=selftest — declares cases, runs from boot.js */

    /* widgets — reusable pieces that appear inside content views */
    'js/widgets/md-panel.js',
    'js/widgets/md-live.js',
    'js/widgets/item-card.js',
    'js/widgets/parent-editor.js',
    'js/widgets/follow.js',

    /* shell → sidebar (left column) */
    'js/shell/sidebar/sidebar.js',
    'js/shell/sidebar/index-editor.js',

    /* shell → topbar (across the top, left to right) */
    'js/shell/topbar/chrome.js',
    'js/shell/topbar/mode-toggle.js',
    'js/shell/topbar/world-menu.js',
    'js/shell/topbar/search.js',
    'js/shell/topbar/user-menu.js',
    'js/shell/topbar/notifications.js',
    'js/shell/topbar/wiring.js',

    /* content — full-page views */
    'js/content/gallery.js',
    'js/content/profile.js',
    'js/content/home.js',
    'js/content/world-settings.js',
    'js/content/new-group.js',

    /* content → group (one file per group type, plus shared chrome) */
    'js/content/group/header.js',
    'js/content/group/settings.js',
    'js/content/group/items.js',
    'js/content/group/menu.js',
    'js/content/group/list.js',
    'js/content/group/dag.js',
    'js/content/group/graph.js',
    'js/content/group/text.js',

    /* content → item detail */
    'js/content/detail/detail-actions.js',
    'js/content/detail/detail.js',

    'js/shell/viewport.js',

    /* shell → router + the query-string URL layer on top of it, then
       bootstrap LAST (the only file that runs on load) */
    'js/shell/router.js',
    'js/shell/url.js',
    'js/shell/boot.js',
  ];

  FILES.forEach(src => {
    const s = document.createElement('script');
    s.src = src + '?v=' + VERSION;
    s.async = false; // preserve execution order for dynamically-inserted scripts
    document.head.appendChild(s);
  });
})();
