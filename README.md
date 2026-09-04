# PlotPot

A browser-based worldbuilding wiki. Keep lore, characters, places, factions and
timelines for your writing projects — with public worlds, follows, likes and
notifications on top.

No build step, no bundler, no dependencies to install: it is plain HTML, CSS and
JavaScript served as static files. Supabase provides auth and storage.

## Features

- **Worlds** — each world is a set of groups (Characters, Places, …), each group a
  set of items with Markdown content.
- **Views** — gallery, list, DAG, force graph, and long-form text per group.
- **Cross-references** — link items to each other and to parents; the graph and
  DAG views are built from those links.
- **Social** — public worlds, profiles, following worlds and people, likes, tag
  suggestions, and a notification inbox.
- **New-content tracking** — per-element "seen" state synced across devices.
- **Shareable links** — every screen has a URL; **Copy link** in the ⋯ menu (and
  on a card) hands you a link straight to that world, group or card.
- **Import / export** — XML round-trip, plus Markdown export.

## Running it

Any static file server works. From the repo root:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. Opening `index.html` directly off the
filesystem will not work — the Supabase OAuth redirect and the script loader
both need an `http(s)` origin.

## Setup

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run [`supabase.sql`](supabase.sql). It is idempotent —
   safe to re-run after schema changes.
3. Copy **Project Settings → API → Project URL** and the **anon/publishable key**
   into [`shared/config.js`](shared/config.js).
4. *(Optional)* Enable social login — see below.

### Social login

The gate offers **Continue with Google** and **Continue with GitHub**. Both are
configured entirely in the Supabase dashboard — **no client ID or secret goes in
this repo**. The browser only names the provider (`Auth.signInWithProvider`);
Supabase holds the credentials and performs the token exchange.

**Google** — in [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
create an *OAuth client ID* of type **Web application**:

- *Authorised JavaScript origins*: your site origin, e.g. `https://<user>.github.io`
- *Authorised redirect URI*: `https://<your-project>.supabase.co/auth/v1/callback`

Then paste the **Client ID** and **Client secret** into Supabase under
**Authentication → Providers → Google**, and toggle it on.

**GitHub** — create an OAuth app at GitHub → Settings → Developer settings →
OAuth Apps with the same callback URL, then paste its Client ID and secret into
**Authentication → Providers → GitHub**.

For either provider, the site origin must also be listed under **Authentication →
URL Configuration → Redirect URLs**, or the sign-in will complete and then bounce
to the wrong place.

The key in `config.js` is the public anon key — it is meant to ship to the
browser. Every table has Row-Level Security enabled, so what a signed-in user can
read and write is enforced by Postgres, not by the client. The login gate in
`shared/auth-gate.js` is UX only; it hides the UI, it does not protect data.

## URLs

GitHub Pages serves one file and knows nothing about our screens, so there are
no real paths to route on — `/characters/aria` would just 404. The route lives
in the query string instead, which any static host hands back untouched:

| URL | Screen |
| --- | --- |
| `/` | the gallery (the default) |
| `/?site=profile&id=<userId>` | an author's profile |
| `/?site=new-world` | the create-a-world form |
| `/?site=world&id=<worldId>` | a world's home page |
| `/?site=world&id=<worldId>&g=<groupSlug>` | a group inside it |
| `/?site=world&id=<worldId>&g=<groupSlug>&card=<itemId>` | one card in that group |

`js/shell/url.js` owns both directions: every navigation in `router.js` mirrors
its state into the address bar, and Back/Forward (or a pasted link) replays a
URL back into the app. A link the app can't honour — a deleted world, a renamed
group, a private one you can't see — degrades to the nearest thing it can show
and the address bar is rewritten to match, so it never points at a screen you
aren't on.

A shared link survives sign-in, including the OAuth round trip: the provider
sends you back to a bare URL, so `Auth.signInWithProvider` parks the query in
`sessionStorage` first and `Url.start()` picks it up.

Private worlds stay private — a link to one is only a *route*. Row-Level
Security still decides whether the world loads, so a stranger following the link
gets "World not found or not accessible" and lands on the gallery.

## Deploying

Push to GitHub and enable **Pages** on the branch root — there is nothing to
build. Add the Pages URL to Supabase under **Authentication → URL Configuration →
Redirect URLs** so OAuth comes back to the right place.

## Layout

`js/` is organised by **where the code shows up on screen**, so you can find a
file by pointing at the UI:

```
┌──────────┬────────────────────────────────────────────┐
│ sidebar/ │ topbar/                                    │
│  logo    │  ☰ brand breadcrumb search │ View/Edit ⋯🔔👤│
│  menu    ├────────────────────────────────────────────┤
│  +group  │ content/                                   │
│          │   gallery · profile · home · group · detail│
└──────────┴────────────────────────────────────────────┘
```

```
index.html               page shell: topbar + sidebar markup, one loader <script>
lib/loader.js            script manifest + cache-busting VERSION (bump on deploy)
lib/UI.js                small DOM builder used throughout
lib/marked.min.js        Markdown renderer (vendored)

js/core/                 no screen position — model, services, utilities
  state.js               in-memory app state
  cloud.js               Supabase data layer (profiles, worlds, follows, likes, …)
  data.js                world/group/item model helpers
  seen.js                per-element "seen" tracking
  icons.js  markdown.js  xml.js

js/shell/                the persistent frame around the content area
  boot.js                bootstrap — the only file that runs on load; stays last
  router.js              navigation + which view is active
  url.js                 query-string routing: shareable links, Back/Forward
  sidebar/
    sidebar.js           the left menu tree
    index-editor.js      owner-only editor for that tree's order/nesting
  topbar/
    wiring.js            topbar entry point; brand, hamburger, dropdown behaviour
    chrome.js            breadcrumb + which topbar controls are visible
    mode-toggle.js       View / Edit
    world-menu.js        ⋯ copy link, settings, export XML/Markdown, import
    search.js            search box
    notifications.js     🔔 bell + its dropdown panel
    user-menu.js         👤 avatar, profile, sign out

js/content/              whatever fills #main-content
  gallery.js  profile.js  home.js  world-settings.js  new-group.js
  group/                 one file per group type, plus shared chrome
    list.js  graph.js  dag.js  text.js  menu.js  settings.js  header.js
  detail/
    detail.js  detail-actions.js

js/widgets/              reusable pieces that appear inside content views
  md-panel.js  item-card.js  ref-editor.js  parent-editor.js  follow.js

css/                     base, layout, components, social
shared/                  Supabase config, auth wrapper, login gate
supabase.sql             full schema: tables, RLS policies, functions, triggers
```

There is no bundler: every file declares plain globals, and `lib/loader.js`
injects them in order with `async=false`. Two rules follow from that:

- **Adding a file means adding it to the `FILES` list in `lib/loader.js`** —
  otherwise it simply never loads.
- **`js/shell/boot.js` must stay last.** Every other file only *declares*
  things; boot.js is the one that *runs*, so everything it touches has to exist
  by then.

Bumping `VERSION` in `lib/loader.js` (and the `?v=` on the loader tag in
`index.html`) is what busts the browser cache after a deploy.
