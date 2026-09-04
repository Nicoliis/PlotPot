function _computeLevels(items) {
  const idx = {};
  items.forEach((item, i) => { idx[item.name] = i; });

  // DFS: mark back-edges (cycle-forming) so they are excluded from level computation
  const color = new Array(items.length).fill(0); // 0=white 1=in-stack 2=done
  const backEdges = new Set();                    // "pi,i" strings
  function dfs(i) {
    color[i] = 1;
    (items[i].parents || []).forEach(pName => {
      const pi = idx[pName];
      if (pi === undefined) return;
      if (color[pi] === 1) backEdges.add(pi + ',' + i);
      else if (!color[pi]) dfs(pi);
    });
    color[i] = 2;
  }
  items.forEach((_, i) => { if (!color[i]) dfs(i); });

  const levels = new Array(items.length).fill(0);
  for (let pass = 0; pass < items.length; pass++) {
    let changed = false;
    items.forEach((item, i) => {
      (item.parents || []).forEach(pName => {
        const pi = idx[pName];
        if (pi === undefined || backEdges.has(pi + ',' + i)) return;
        if (levels[pi] + 1 > levels[i]) { levels[i] = levels[pi] + 1; changed = true; }
      });
    });
    if (!changed) break;
  }
  return { levels, backEdges };
}

function _buildDAG(group, levels, backEdges) {
  const items = group.items;
  const COL = 200, ROW = 64, NW = 160, NH = 38, PAD = 20, LANE = 22, R = 8;
  const HALF_GAP = (COL - NW) / 2;
  const NS = 'http://www.w3.org/2000/svg';

  const nameIdx = {};
  items.forEach((item, i) => { nameIdx[item.name] = i; });
  const byLevel = {};
  levels.forEach((lv, i) => { (byLevel[lv] = byLevel[lv] || []).push(i); });

  let longCount = 0;
  items.forEach((item, i) => {
    (item.parents || []).forEach(pName => {
      const pi = nameIdx[pName];
      if (pi !== undefined && !backEdges.has(pi + ',' + i) && levels[i] - levels[pi] > 1) longCount++;
    });
  });
  const topPad    = PAD + longCount * LANE;
  const maxLv     = Math.max(...levels, 0);
  const maxCount  = Math.max(...Object.values(byLevel).map(a => a.length), 1);
  const nodeBtm   = topPad + maxCount * ROW;

  const pos = [];
  Object.entries(byLevel).forEach(([lv, indices]) =>
    indices.forEach((i, rank) => { pos[i] = { x: PAD + parseInt(lv) * COL, y: topPad + rank * ROW }; })
  );

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width',  (maxLv + 1) * COL + PAD * 2);
  svg.setAttribute('height', nodeBtm + PAD + backEdges.size * LANE);

  // Arrow markers
  const defs = document.createElementNS(NS, 'defs');
  [[`arr`, `#6366f1`], [`arr-back`, `#f97316`]].forEach(([id, fill]) => {
    const m = document.createElementNS(NS, 'marker');
    Object.entries({ id, markerWidth:8, markerHeight:6, refX:7, refY:3, orient:'auto' })
      .forEach(([k, v]) => m.setAttribute(k, v));
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M0,0 L7,3 L0,6 Z'); p.setAttribute('fill', fill);
    m.appendChild(p); defs.appendChild(m);
  });
  svg.appendChild(defs);

  function mkPath(d, stroke, dashed, markerId) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d); p.setAttribute('stroke', stroke);
    p.setAttribute('stroke-width', '1.5'); p.setAttribute('fill', 'none');
    if (dashed) p.setAttribute('stroke-dasharray', '6,4');
    p.setAttribute('marker-end', `url(#${markerId})`);
    svg.appendChild(p);
  }

  // Forward edges
  let longIdx = 0;
  items.forEach((item, i) => {
    (item.parents || []).forEach(pName => {
      const pi = nameIdx[pName];
      if (pi === undefined || backEdges.has(pi + ',' + i)) return;
      const span = levels[i] - levels[pi];
      if (span <= 0) return;
      const f = pos[pi], t = pos[i];
      const x1 = f.x + NW, y1 = f.y + NH / 2, x2 = t.x, y2 = t.y + NH / 2;
      let d;
      if (span === 1) {
        const mx = (x1 + x2) / 2;
        d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
      } else {
        const laneY = topPad - LANE * (longIdx + 1) + LANE / 2; longIdx++;
        const gapX = x2 - HALF_GAP, ds = y2 > laneY ? 1 : -1;
        d = [`M${x1},${y1}`, `Q${x1},${laneY} ${x1+R},${laneY}`, `H${gapX-R}`,
             `Q${gapX},${laneY} ${gapX},${laneY+ds*R}`, `V${y2-ds*R}`,
             `Q${gapX},${y2} ${gapX+R},${y2}`, `H${x2}`].join(' ');
      }
      mkPath(d, '#6366f1', false, 'arr');
    });
  });

  // Back-edges (cycles) — orange dashed arcs routed below the node area
  let backIdx = 0;
  backEdges.forEach(key => {
    const [pi, i] = key.split(',').map(Number);
    const f = pos[pi], t = pos[i];
    const x1 = f.x, y1 = f.y + NH / 2;        // exit parent's left edge
    const x2 = t.x + NW, y2 = t.y + NH / 2;   // enter child's right edge
    const laneY = nodeBtm + LANE * (++backIdx);
    mkPath(`M${x1},${y1} Q${(x1+x2)/2},${laneY} ${x2},${y2}`, '#f97316', true, 'arr-back');
  });

  // Nodes (drawn last — on top of edges)
  items.forEach((item, i) => {
    const { x, y } = pos[i];
    const g = document.createElementNS(NS, 'g');
    g.style.cursor = 'pointer';
    g.addEventListener('click', () => navigateToItem(group.slug, i));
    const rect = document.createElementNS(NS, 'rect');
    Object.entries({ x, y, width:NW, height:NH, rx:7, fill:'#1a1a2e', stroke:'#6366f1', 'stroke-width':1 })
      .forEach(([k, v]) => rect.setAttribute(k, v));
    const text = document.createElementNS(NS, 'text');
    Object.entries({ 'text-anchor':'middle', fill:'#e0e0ff', 'font-size':13, 'font-family':'system-ui' })
      .forEach(([k, v]) => text.setAttribute(k, v));
    text.setAttribute('x', x + NW / 2); text.setAttribute('y', y + NH / 2 + 5);
    text.textContent = item.name.length > 22 ? item.name.slice(0, 20) + '…' : item.name;
    g.appendChild(rect); g.appendChild(text); svg.appendChild(g);
  });

  return svg;
}
