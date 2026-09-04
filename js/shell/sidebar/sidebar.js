function buildSidebar() {
  const menu = UI.get('menu');
  const logo = document.querySelector('.logo');
  menu.innerHTML = '';

  // ── Gallery / profile chrome (no world open) ──
  if (!State.currentWorld) {
    logo.textContent = 'PlotPot';
    const sec = UI.make('div').class('menu-section');
    sec.withChilds(UI.make('h3').text('Browse'));
    sec.withChilds(_sideItem('gallery', 'Gallery',    'gallery',   () => goGallery()));
    sec.withChilds(_sideItem('user',    'My Profile', 'profile',   () => goProfile()));
    sec.withChilds(_sideItem('plus',    'New World',  'new-world', () => goNewWorld()));
    menu.appendChild(sec.getElement());
    return;
  }

  // ── Inside a world ──
  logo.textContent = State.currentWorld.title || 'World';

  const top = UI.make('div').class('menu-section');
  top.withChilds(_sideItem('back', 'Back to Gallery', null, () => goGallery()));
  menu.appendChild(top.getElement());

  const coreSection = UI.make('div').class('menu-section');
  coreSection.withChilds(UI.make('h3').text('Core'));
  coreSection.withChilds(makeHomeItem());
  if (isOwner() && State.editMode)
    coreSection.withChilds(
      UI.make('div').class('menu-item', State.currentView === 'index-editor' ? 'active' : '')
        .innerHTML(Icons.label('settings', 'Edit index'))
        .on('click', () => openIndexEditor())
    );
  menu.appendChild(coreSection.getElement());

  // User-defined nested index (replaces the old Lists/Graphs/Texts buckets).
  const treeEl = UI.make('div').class('menu-section').getElement();
  groupChildren(null).forEach(g => _renderTreeNode(treeEl, g, 0));
  menu.appendChild(treeEl);
}

// Recursively render a group node and (for menus) its children, honouring
// per-node visibility for non-owners.
function _renderTreeNode(parentEl, group, depth) {
  if (!isOwner() && group.isPublic === false) return;   // hidden subtree for readers
  parentEl.appendChild(makeMenuItem(group, depth).getElement());
  if (group.type === 'menu')
    groupChildren(group.slug).forEach(c => _renderTreeNode(parentEl, c, depth + 1));
}

function makeHomeItem() {
  const item = UI.make('div')
    .class('menu-item', State.currentView === 'home' ? 'active' : '')
    .on('click', () => navigate('home'))
    .withChilds(UI.make('span').text('Home'));
  if (homeHasUnseen()) item.withChilds(UI.make('span').class('menu-dot').attrs({ title: 'New updates' }));
  return item;
}

function makeMenuItem(group, depth = 0) {
  const item = UI.make('div')
    .class('menu-item', State.currentView === group.slug ? 'active' : '')
    .style({ paddingLeft: (12 + depth * 16) + 'px' })
    .on('click', () => navigate(group.slug));

  item.withChilds(
    UI.make('span').class('menu-label').withChilds(
      UI.make('span').class('ic', 'menu-type-ic').innerHTML(Icons.get(groupTypeIcon(group))),
      UI.make('span').text(group.name)
    )
  );

  if (!isOwner() && group.isPublic === false) return item;       // (defensive; subtree already skipped)
  if (groupHasUnseen(group)) item.withChilds(UI.make('span').class('menu-dot').attrs({ title: 'New updates' }));
  return item;
}

// Sidebar nav entry for top-level destinations (gallery/profile/new world/back).
function _sideItem(icon, label, activeView, onClick) {
  return UI.make('div')
    .class('menu-item', activeView && State.currentView === activeView ? 'active' : '')
    .innerHTML(Icons.label(icon, label))
    .on('click', onClick);
}

/* Static sidebar furniture, wired once at boot (buildSidebar only rebuilds #menu). */
function _wireSidebar() {
  UI.get('btn-new-group').addEventListener('click', () => navigate('new-group'));
  UI.get('sidebar-backdrop').addEventListener('click', () => document.body.classList.remove('sidebar-open'));
}
