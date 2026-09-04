/* Notifications dropdown panel: tag suggestions (accept/dismiss) and other alerts. */

async function _refreshNotifBadge() {
  const badge = UI.get('notif-count');
  if (!badge) return;
  let n = 0;
  try { n = await Cloud.unreadCount(); } catch (e) { console.error(e); }
  if (n > 0) { badge.textContent = n > 9 ? '9+' : String(n); badge.style.display = ''; }
  else badge.style.display = 'none';
}

async function renderNotifications() {
  const panel = UI.get('notif-panel');
  panel.innerHTML = '<p class="muted-pad">Loading…</p>';

  const items = await Cloud.notifications();
  panel.innerHTML = '';

  const head = UI.make('div').class('notif-head').withChilds(UI.make('strong').text('Notifications'));
  panel.appendChild(head.getElement());

  if (!items.length) {
    panel.appendChild(UI.make('p').class('muted-pad').text('Nothing yet.').getElement());
    return;
  }
  items.forEach(n => panel.appendChild(_notifRow(n)));
}

function _notifRow(n) {
  const actor = n.actor || {};
  const who = actor.display_name || actor.username || 'Someone';
  const worldTitle = n.world?.title || 'a world';
  const row = UI.make('div').class('notif-row', n.read ? '' : 'notif-row--unread');

  if (n.type === 'tag_suggestion') {
    const tag = n.data?.tag || '';
    row.withChilds(
      UI.make('div').class('notif-text').innerHTML(
        `<strong>${who}</strong> suggested the tag <span class="tag-chip">#${tag}</span> for <strong>${worldTitle}</strong>`
      ),
      UI.make('div').class('notif-actions').withChilds(
        UI.make('button').class('btn-primary', 'btn-xs').text('Add tag').on('click', async e => {
          e.stopPropagation();
          await Cloud.addTagToWorld(n.world_id, tag);
          // reflect immediately if this world is open
          if (State.currentWorld?.id === n.world_id && !(State.currentWorld.tags || []).includes(tag)) {
            State.currentWorld.tags = [...(State.currentWorld.tags || []), tag];
          }
          await Cloud.markNotifRead(n.id);
          row.getElement().remove();
          _refreshNotifBadge();
        }),
        UI.make('button').class('btn-secondary', 'btn-xs').text('Dismiss').on('click', async e => {
          e.stopPropagation();
          await Cloud.dismissNotif(n.id);
          row.getElement().remove();
          _refreshNotifBadge();
        })
      )
    );
  } else {
    row.withChilds(UI.make('div').class('notif-text').text(`${who}: ${n.type}`));
    row.on('click', async () => { await Cloud.markNotifRead(n.id); row.getElement().classList.remove('notif-row--unread'); _refreshNotifBadge(); });
  }

  // clicking the text area opens the world
  if (n.world_id) {
    row.withChilds(
      UI.make('button').class('notif-open').text('View world').on('click', e => {
        e.stopPropagation();
        UI.get('notif-wrap').classList.remove('open');
        openWorld(n.world_id);
      })
    );
  }
  return row.getElement();
}

// The bell itself: opens the panel and (re)loads its contents.
function _wireNotifBell() {
  UI.get('notif-btn').addEventListener('click', e => {
    e.stopPropagation();
    const wrap = UI.get('notif-wrap');
    document.querySelectorAll('.dropdown.open').forEach(d => { if (d !== wrap) d.classList.remove('open'); });
    const opening = !wrap.classList.contains('open');
    wrap.classList.toggle('open');
    if (opening) renderNotifications();
  });
}
