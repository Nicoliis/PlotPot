/* Profile page: identity, favorite tags, a ranked "published tags" cloud, and the author's worlds. */

async function renderProfile(userId) {
  const content = UI.get('main-content');
  content.innerHTML = '<p style="color:var(--text-muted);padding:12px">Loading profile…</p>';

  const uid = window.Auth?.getUser()?.id;
  const isMe = userId === uid;

  const [profile, worlds, published, counts] = await Promise.all([
    Cloud.getProfile(userId),
    Cloud.listByOwner(userId),
    Cloud.publishedTags(userId),
    Cloud.userFollowCounts(userId),
  ]);

  content.innerHTML = '';
  if (!profile) {
    content.appendChild(UI.make('p').style({ color: 'var(--text-muted)', padding: '12px' })
      .text('Profile not found.').getElement());
    return;
  }
  if (isMe) State.profile = profile;

  const wrap = UI.make('div').class('profile-view');
  wrap.withChilds(isMe ? _editableHeader(profile, counts) : _readonlyHeader(profile, counts));
  wrap.withChilds(_favoriteTags(profile, isMe));
  if (isMe) wrap.withChilds(_mutedTags(profile));
  wrap.withChilds(_publishedCloud(published));
  wrap.withChilds(_worldList(worlds, isMe));
  content.appendChild(wrap.getElement());
}

function _avatar(profile, size) {
  const name = profile.display_name || profile.username || '?';
  if (profile.avatar_url) {
    return UI.make('img').class('avatar', 'avatar--lg').attrs({ src: profile.avatar_url, alt: name })
      .style({ width: size, height: size });
  }
  return UI.make('span').class('avatar', 'avatar--initial', 'avatar--lg').text(name[0].toUpperCase())
    .style({ width: size, height: size });
}

function _followCounts(counts) {
  return UI.make('div').class('profile-stats').withChilds(
    UI.make('span').withChilds(UI.make('strong').text(String(counts.followers)), UI.make('span').class('muted').text(' followers')),
    UI.make('span').withChilds(UI.make('strong').text(String(counts.following)), UI.make('span').class('muted').text(' following'))
  );
}

function _readonlyHeader(profile, counts) {
  const meta = UI.make('div').style({ flex: '1' }).withChilds(
    UI.make('h1').text(profile.display_name || profile.username || 'Anonymous'),
    UI.make('p').class('profile-username').text('@' + (profile.username || 'user'))
  );
  if (profile.bio) meta.withChilds(UI.make('p').class('profile-bio').text(profile.bio));
  meta.withChilds(_followCounts(counts));
  const fb = followUserButton(profile.id);
  if (fb) meta.withChilds(UI.make('div').style({ marginTop: '12px' }).withChilds(fb));
  return UI.make('div').class('profile-header').withChilds(_avatar(profile, '72px'), meta);
}

function _editableHeader(profile, counts) {
  const username = UI.make('input').class('field-input').value(profile.username || '').attrs({ placeholder: 'username' });
  const display  = UI.make('input').class('field-input').value(profile.display_name || '').attrs({ placeholder: 'Display name' });
  const avatar   = UI.make('input').class('field-input').value(profile.avatar_url || '').attrs({ placeholder: 'Avatar image URL' });
  const bio      = UI.make('textarea').class('field-input').value(profile.bio || '').attrs({ placeholder: 'Short bio…', rows: '3' });

  const msg = UI.make('span').class('profile-msg');
  const save = UI.make('button').class('btn-primary').text('Save profile').on('click', async () => {
    save.getElement().disabled = true;
    try {
      const updated = await Cloud.saveProfile({
        username:     username.getElement().value.trim() || null,
        display_name: display.getElement().value.trim() || null,
        avatar_url:   avatar.getElement().value.trim() || null,
        bio:          bio.getElement().value.trim() || null,
      });
      State.profile = updated;
      msg.text('Saved').getElement().className = 'profile-msg profile-msg--ok';
    } catch (e) {
      msg.text(e.message.includes('duplicate') ? 'That username is taken.' : 'Save failed.')
         .getElement().className = 'profile-msg profile-msg--err';
    }
    save.getElement().disabled = false;
  });

  return UI.make('div').class('profile-header', 'profile-header--edit').withChilds(
    _avatar(profile, '72px'),
    UI.make('div').style({ flex: '1' }).withChilds(
      _field('Username', username),
      _field('Display name', display),
      _field('Avatar URL', avatar),
      _field('Bio', bio),
      UI.make('div').style({ display: 'flex', alignItems: 'center', gap: '12px' }).withChilds(save, msg),
      _followCounts(counts)
    )
  );
}

function _field(label, inputBuilder) {
  return UI.make('div').class('field-group').withChilds(UI.make('label').text(label), inputBuilder);
}

function _favoriteTags(profile, isMe) {
  const sec = UI.make('div').class('profile-section');
  sec.withChilds(UI.make('h2').text('Favorite tags'));
  const fav = profile.favorite_tags || [];

  if (!isMe) {
    const chips = UI.make('div').class('world-tags');
    if (!fav.length) chips.withChilds(UI.make('span').class('profile-empty').text('None yet.'));
    fav.forEach(t => chips.withChilds(UI.make('span').class('tag-chip').text('#' + t)));
    return sec.withChilds(chips);
  }

  const input = UI.make('input').class('field-input').value(fav.join(', '))
    .attrs({ placeholder: 'fantasy, sci-fi, noir (comma separated)' });
  const msg = UI.make('span').class('profile-msg');
  const save = UI.make('button').class('btn-secondary').text('Save tags').on('click', async () => {
    try {
      const updated = await Cloud.saveProfile({ favorite_tags: parseTags(input.getElement().value) });
      State.profile = updated;
      msg.text('Saved').getElement().className = 'profile-msg profile-msg--ok';
    } catch { msg.text('Save failed.').getElement().className = 'profile-msg profile-msg--err'; }
  });
  return sec.withChilds(
    UI.make('div').style({ display: 'flex', gap: '10px', alignItems: 'center' }).withChilds(input, save, msg)
  );
}

// Tags the user never wants to see in their Following feed.
function _mutedTags(profile) {
  const sec = UI.make('div').class('profile-section');
  sec.withChilds(UI.make('h2').text('Muted tags'));
  sec.withChilds(UI.make('p').class('muted').style({ marginBottom: '8px', fontSize: '13px' })
    .text('Worlds tagged with these are hidden from your feed.'));
  const input = UI.make('input').class('field-input').value((profile.muted_tags || []).join(', '))
    .attrs({ placeholder: 'spoilers, grimdark (comma separated)' });
  const msg = UI.make('span').class('profile-msg');
  const save = UI.make('button').class('btn-secondary').text('Save muted tags').on('click', async () => {
    try {
      const updated = await Cloud.saveProfile({ muted_tags: parseTags(input.getElement().value) });
      State.profile = updated;
      msg.text('Saved').getElement().className = 'profile-msg profile-msg--ok';
    } catch { msg.text('Save failed.').getElement().className = 'profile-msg profile-msg--err'; }
  });
  return sec.withChilds(
    UI.make('div').style({ display: 'flex', gap: '10px', alignItems: 'center' }).withChilds(input, save, msg)
  );
}

// Ranked tag list — font size scales with use count (the "multiplier").
function _publishedCloud(published) {
  const sec = UI.make('div').class('profile-section');
  sec.withChilds(UI.make('h2').text('Published tags'));
  if (!published.length) {
    return sec.withChilds(UI.make('p').class('profile-empty').text('No public worlds with tags yet.'));
  }
  const max = published[0].count;
  const cloud = UI.make('div').class('tag-cloud');
  published.forEach(({ tag, count }) => {
    const size = 13 + Math.round((count / max) * 13); // 13–26px
    cloud.withChilds(
      UI.make('span').class('tag-chip', 'tag-chip--cloud')
        .style({ fontSize: size + 'px' })
        .text(`#${tag} ×${count}`)
        .on('click', () => { _galleryFilter = { text: '', tag }; goGallery(); })
    );
  });
  return sec.withChilds(cloud);
}

function _worldList(worlds, isMe) {
  const uid = window.Auth?.getUser()?.id;
  const sec = UI.make('div').class('profile-section');
  sec.withChilds(UI.make('h2').text(isMe ? 'My worlds' : 'Worlds'));
  if (!worlds.length) {
    return sec.withChilds(UI.make('p').class('profile-empty').text('No worlds yet.'));
  }
  const grid = UI.make('div').class('world-grid');
  worlds.forEach(w => grid.withChilds(_worldCard(w, uid)));
  return sec.withChilds(grid);
}
