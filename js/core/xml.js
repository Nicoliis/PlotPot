function esc(s)   { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function cdata(s) { return '<![CDATA[' + (s||'').replace(/\]\]>/g, ']]]]><![CDATA[>') + ']]>'; }

/* ── XML: full round-trip (import re-creates exactly what export wrote) ──
   Carries every group field the app now uses: type (incl. 'menu'),
   visibility, nesting (parent), intro, per-item template, ids, parents. */
function exportXML() {
  const title = State.currentWorld?.title || '';
  let x = `<?xml version="1.0" encoding="UTF-8"?>\n<plotpot title="${esc(title)}">\n`;
  x += `  <home>${cdata(State.data?.home?.content || '')}</home>\n  <groups>\n`;

  for (const g of (State.data?.groups || [])) {
    const attrs = [
      `name="${esc(g.name)}"`,
      `slug="${esc(g.slug)}"`,
      `type="${esc(g.type)}"`,
      `is-public="${g.isPublic === false ? 'false' : 'true'}"`,
    ];
    if (g.parentId) attrs.push(`parent="${esc(g.parentId)}"`);
    x += `    <group ${attrs.join(' ')}>\n`;

    if (g.intro)        x += `      <intro>${cdata(g.intro)}</intro>\n`;
    if (g.itemTemplate) x += `      <template>${cdata(g.itemTemplate)}</template>\n`;

    if (g.type === 'text') {
      x += `      <content>${cdata(g.content || '')}</content>\n`;
    } else if (g.type !== 'menu') {
      for (const item of (g.items || [])) {
        x += `      <item id="${esc(item.id || '')}" name="${esc(item.name)}">\n`;
        if (g.type === 'graph')
          x += `        <parents>${(item.parents||[]).map(p=>`<parent>${esc(p)}</parent>`).join('')}</parents>\n`;
        x += `        <content>${cdata(item.content || '')}</content>\n      </item>\n`;
      }
    }
    x += `    </group>\n`;
  }
  return x + `  </groups>\n</plotpot>`;
}

function importXML(xmlStr) {
  const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');
  if (doc.querySelector('parsererror')) { alert('Invalid XML file'); return; }

  const homeEl = doc.querySelector('home');
  if (homeEl) State.data.home.content = homeEl.textContent;

  State.data.groups = [];
  doc.querySelectorAll('groups > group').forEach(g => {
    const type = g.getAttribute('type') || 'list';
    const group = {
      name: g.getAttribute('name'),
      slug: g.getAttribute('slug'),
      type,
      isPublic: g.getAttribute('is-public') === 'false' ? false : true,
    };
    if (g.getAttribute('parent')) group.parentId = g.getAttribute('parent');

    const introEl = g.querySelector(':scope > intro');
    if (introEl) group.intro = introEl.textContent;
    const tmplEl = g.querySelector(':scope > template');
    if (tmplEl) group.itemTemplate = tmplEl.textContent;

    if (type === 'menu') {
      // folder node — no content or items
    } else if (type === 'text') {
      group.content = g.querySelector(':scope > content')?.textContent || '';
    } else {
      group.items = [];
      g.querySelectorAll(':scope > item').forEach(el => {
        const item = {
          id:      el.getAttribute('id') || generateId(),
          name:    el.getAttribute('name'),
          content: el.querySelector('content')?.textContent || '',
        };
        if (type === 'graph')
          item.parents = [...el.querySelectorAll('parents > parent')].map(p => p.textContent);
        group.items.push(item);
      });
    }
    State.data.groups.push(group);
  });
  saveData();
}

/* ── Single Markdown export (one document to feed an AI as context) ──
   Walks the index tree in display order; heading depth mirrors the nesting.
   Includes private sections too — it's the owner's own full export. */
function exportMarkdown() {
  const w = State.currentWorld;
  const H = n => '#'.repeat(Math.min(n, 6)) + ' ';
  let md = H(1) + (w?.title || 'Untitled World') + '\n\n';
  if (w?.description) md += w.description.trim() + '\n\n';

  const home = (State.data?.home?.content || '').trim();
  if (home) md += home + '\n\n';

  flattenGroupTree().forEach(({ group, depth }) => {
    md += H(depth + 2) + group.name + '\n\n';
    if (group.intro && group.intro.trim()) md += group.intro.trim() + '\n\n';

    if (group.type === 'text') {
      if (group.content && group.content.trim()) md += group.content.trim() + '\n\n';
    } else if (group.type !== 'menu') {
      (group.items || []).forEach(it => {
        md += H(depth + 3) + (it.name || 'Untitled') + '\n\n';
        if (group.type === 'graph' && it.parents && it.parents.length)
          md += '*Follows: ' + it.parents.join(', ') + '*\n\n';
        if (it.content && it.content.trim()) md += it.content.trim() + '\n\n';
      });
    }
  });
  return md.trimEnd() + '\n';
}
