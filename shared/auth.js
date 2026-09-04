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
 *   Auth.onChange(fn)               — fn({ user }) called on session change
 */

const Auth = (() => {
  let _client = null;
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
  // after a redirect login, so credentials never linger in the URL.
  function _stripAuthParams() {
    const { hash, search, pathname } = window.location;
    const dirty = /(access_token|refresh_token|provider_token|expires_at|token_type)=/.test(hash)
               || /[?&](code|state)=/.test(search);
    if (dirty) window.history.replaceState(null, document.title, pathname);
  }

  async function _doInit() {
    if (!_configured()) return;

    const { createClient } = window.supabase;
    _client = createClient(
      window.NICOTOLS_CONFIG.supabaseUrl,
      window.NICOTOLS_CONFIG.supabaseKey,
      // PKCE keeps tokens out of the URL fragment (a short-lived ?code= is used
      // and exchanged in the background), and we still scrub the URL afterwards.
      { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } }
    );

    const { data: { session } } = await _client.auth.getSession();
    _user = session?.user ?? null;
    _stripAuthParams();

    _client.auth.onAuthStateChange((event, session) => {
      _user = session?.user ?? null;
      if (event === 'SIGNED_IN') _stripAuthParams();
      _notify();
    });
  }

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
    if (!_client) return;
    await _client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.href },
    });
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

  return { init, getUser, getClient, isConfigured, signIn, signUp,
           signInWithProvider, signInWithGitHub, signInWithGoogle, signOut, onChange };
})();

window.Auth = Auth;
