/**
 * PlotPot — Auth module
 *
 * Wraps Supabase auth. Exposes a simple API used by auth-gate.js and js/cloud.js.
 * Falls back gracefully when Supabase is not configured.
 *
 * API:
 *   Auth.init()                     — call once on page load
 *   Auth.getUser()                  → { id, email } | null
 *   Auth.signIn(email, password)    → { error? }
 *   Auth.signUp(email, password)    → { error? }
 *   Auth.signInWithProvider(name)   → redirects (github, google, …)
 *   Auth.signInWithGitHub()         → shorthand for the above
 *   Auth.signInWithGoogle()         → shorthand for the above
 *   Auth.signOut()
 *   Auth.getLastError()             → message from a failed redirect login, or null
 *   Auth.onChange(fn)               — fn({ user }) called on session change
 */

const Auth = (() => {
  let _client = null;
  let _lastError = null;
  let _user = null;
  const _listeners = [];

  function _configured() {
    const cfg = window.NICOTOLS_CONFIG;
    return cfg &&
      cfg.supabaseUrl  && cfg.supabaseUrl  !== 'YOUR_SUPABASE_URL' &&
      cfg.supabaseKey  && cfg.supabaseKey  !== 'YOUR_SUPABASE_ANON_KEY';
  }

  function _notify() {
    _listeners.forEach(fn => fn({ user: _user }));
  }

  let _initPromise = null;

  async function init() {
    if (_initPromise) return _initPromise;
    _initPromise = _doInit();
    return _initPromise;
  }

  // Remove OAuth tokens / PKCE code from the address bar (and browser history)
  // after a redirect login, so credentials never linger in the URL. Only the
  // auth params go: anything else in the query belongs to the page (PlotPot
  // routes on ?site=…&id=…) and has to survive.
  function _stripAuthParams() {
    const { hash, search, pathname } = window.location;
    const dirty = /(access_token|refresh_token|provider_token|expires_at|token_type)=/.test(hash)
               || /[?&](code|state)=/.test(search);
    if (!dirty) return;
    const params = new URLSearchParams(search);
    ['code', 'state', 'error', 'error_code', 'error_description'].forEach(k => params.delete(k));
    const rest = params.toString();
    window.history.replaceState(null, document.title, pathname + (rest ? '?' + rest : ''));
  }

  async function _doInit() {
    if (!_configured()) return;

    const { createClient } = window.supabase;
    _client = createClient(
      window.NICOTOLS_CONFIG.supabaseUrl,
      window.NICOTOLS_CONFIG.supabaseKey,
      {
        auth: {
          // PKCE keeps tokens out of the URL fragment (a short-lived ?code= is used
          // and exchanged in the background), and we still scrub the URL afterwards.
          flowType: 'pkce',
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
          // Pin the store explicitly. Left to its own feature-detection, supabase-js
          // silently falls back to an in-memory adapter if its probe fails for any
          // reason (privacy extensions can trip it during page load). That "works"
          // until the first OAuth redirect, at which point the PKCE verifier — held
          // only in RAM — is gone, and sign-in fails with no error anywhere.
          storage: window.localStorage,
        },
      }
    );

    // If the store still isn't the real thing, nothing will survive the redirect.
    if (_client.auth.storage !== window.localStorage) {
      console.warn('[auth] Supabase is not using localStorage — OAuth sign-in will not persist.');
    }

    // Did the provider just send us back? If so we must end up with a session;
    // coming home with a ?code= and nothing to show for it means the PKCE
    // verifier didn't survive the round trip. Record it — otherwise the gate
    // just reappears and the user has no idea why.
    const returning = /[?&]code=/.test(window.location.search);

    const { data: { session } } = await _client.auth.getSession();
    _user = session?.user ?? null;

    if (returning && !_user) {
      _lastError = 'Sign-in did not complete. The provider approved you, but this ' +
                   'browser discarded the data needed to finish — usually tracking ' +
                   'protection or blocked site storage. Allow storage for this site, ' +
                   'or try another browser.';
    }

    _stripAuthParams();

    _client.auth.onAuthStateChange((event, session) => {
      _user = session?.user ?? null;
      if (event === 'SIGNED_IN') _stripAuthParams();
      if (_user) _lastError = null;
      _notify();
    });
  }

  function getLastError() { const e = _lastError; _lastError = null; return e; }  // read-once

  function getUser() { return _user; }
  function getClient() { return _client; }
  function isConfigured() { return _configured(); }

  async function signIn(email, password) {
    if (!_client) return { error: { message: 'Supabase not configured' } };
    const { error } = await _client.auth.signInWithPassword({ email, password });
    return { error };
  }

  async function signUp(email, password) {
    if (!_client) return { error: { message: 'Supabase not configured' } };
    const { error } = await _client.auth.signUp({ email, password });
    return { error };
  }

  // OAuth sign-in. The provider's client ID/secret live in the Supabase
  // dashboard (Authentication → Providers), never in this repo — the browser
  // only ever names the provider and gets redirected.
  async function signInWithProvider(provider) {
    if (!_client) return { error: { message: 'Supabase is not configured.' } };

    // PKCE stores a one-time "code verifier" in localStorage and reads it back
    // after the provider redirects us home. Privacy tools and locked-down
    // storage settings can drop that write, and the failure is invisible: the
    // provider signs you in, we come back with a ?code=, and there is nothing
    // to exchange it with. Check before leaving the page so we can say so.
    const store = _storageCheck();
    if (!store.ok) {
      return { error: { message:
        'This browser is blocking site storage, which sign-in needs. Allow storage / ' +
        'tracking-protection exceptions for this site, or try another browser. (' + store.reason + ')'
      } };
    }

    // Send a clean URL: a leftover ?code= or #error= from a previous attempt
    // would be echoed back here and may not match the Supabase redirect allow-list.
    // That also drops the page's own query, so park it — someone who follows a
    // shared link and signs in with a provider should still land on that link.
    // sessionStorage is scoped to this tab and the redirect returns to it.
    try { sessionStorage.setItem('pp:return-to', window.location.search); } catch (e) { /* private mode */ }

    const { error } = await _client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    return { error };
  }

  // Round-trip a value through localStorage; a silent revert is as fatal as a throw.
  function _storageCheck() {
    const k = '__auth_probe__';
    try {
      window.localStorage.setItem(k, '1');
      const back = window.localStorage.getItem(k);
      window.localStorage.removeItem(k);
      if (back !== '1') return { ok: false, reason: 'writes are being discarded' };
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.name || 'blocked' };
    }
  }

  const signInWithGitHub = () => signInWithProvider('github');
  const signInWithGoogle = () => signInWithProvider('google');

  async function signOut() {
    if (!_client) return;
    await _client.auth.signOut();
  }

  function onChange(fn) {
    _listeners.push(fn);
    fn({ user: _user });
  }

  return { init, getUser, getClient, isConfigured, getLastError, signIn, signUp,
           signInWithProvider, signInWithGitHub, signInWithGoogle, signOut, onChange };
})();

window.Auth = Auth;
