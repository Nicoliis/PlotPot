/* The "⋯" world-actions dropdown: share, settings, export XML/Markdown, import XML. */

function _worldFileName() {
  const base = (State.currentWorld?.title || 'plotpot')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return base || 'plotpot';
}

function _wireWorldMenu() {
  // Shares whatever is on screen — the world, a group, or a single card.
  UI.get('btn-share').addEventListener('click', () => Url.copy());

  UI.get('btn-world-settings').addEventListener('click', () => openWorldSettings());

  UI.get('btn-export').addEventListener('click', () => {
    try { downloadFile(exportXML(), _worldFileName() + '.xml', 'application/xml'); }
    catch (e) { console.error('Export XML failed', e); alert('Could not export: ' + e.message); }
  });

  UI.get('btn-export-md').addEventListener('click', () => {
    try { downloadFile(exportMarkdown(), _worldFileName() + '.md', 'text/markdown'); }
    catch (e) { console.error('Export Markdown failed', e); alert('Could not export: ' + e.message); }
  });

  UI.get('btn-import').addEventListener('click', () => UI.get('import-file').click());

  UI.get('import-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { importXML(ev.target.result); buildSidebar(); navigate('home'); };
    reader.readAsText(file);
    e.target.value = '';
  });
}
