/**
 * The real visible height, measured rather than assumed.
 *
 * CSS viewport units cannot answer this on a phone:
 *   100vh  is the viewport with the browser's toolbars HIDDEN — the largest it
 *          ever gets — so a shell sized to it hides its own bottom edge behind
 *          them, which is how the sidebar's New Group button ended up
 *          unreachable.
 *   100dvh tracks the toolbars, which is better, but it still ignores the
 *          on-screen keyboard, and on iOS it lags behind the toolbar's own
 *          show/hide animation.
 *
 * The Visual Viewport API reports what is genuinely on screen at this instant,
 * keyboard included. So we measure it and publish it as --app-h for the CSS,
 * instead of padding the layout by an eyeballed amount and hoping.
 *
 * Three layers, each a real fallback rather than a guess:
 *   --app-h   measured (this file)
 *   100dvh    browser's dynamic viewport, if it has one
 *   100vh     last resort
 * The --app-h rules are scoped to html.app-h, which this file only adds once a
 * height has actually been published — otherwise a browser with neither dvh
 * nor visualViewport would resolve var(--app-h, 100dvh) to an invalid length
 * and collapse the shell to height:auto.
 */

function _appHeight() {
  const vv = window.visualViewport;
  // Pinch-zoom shrinks visualViewport.height: that is a magnified view of the
  // same page, not a smaller screen, so measuring it would squash the shell
  // while the user is zoomed in. Fall back to innerHeight in that case.
  if (vv && Math.abs(vv.scale - 1) < 0.01 && vv.height > 0) return vv.height;
  return window.innerHeight;
}

function _publishAppHeight() {
  const h = _appHeight();
  if (!(h > 0)) return;                       // never publish a zero-height shell
  document.documentElement.style.setProperty('--app-h', Math.round(h) + 'px');
  document.documentElement.classList.add('app-h');
}

function _wireViewport() {
  const vv = window.visualViewport;
  // iOS reports a retracting toolbar as a visualViewport SCROLL, not a resize,
  // so both are needed to keep up with it.
  vv?.addEventListener('resize', _publishAppHeight);
  vv?.addEventListener('scroll', _publishAppHeight);
  // window resize still covers desktop, and orientationchange fires before the
  // new visualViewport metrics settle on some devices, hence the deferred
  // re-measure alongside the immediate one.
  window.addEventListener('resize', _publishAppHeight);
  window.addEventListener('orientationchange', () => {
    _publishAppHeight();
    setTimeout(_publishAppHeight, 250);
  });
  _publishAppHeight();
}
