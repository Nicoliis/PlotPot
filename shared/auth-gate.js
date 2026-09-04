/**
 * PlotPot — Auth Gate
 *
 * Locks a page behind login: nothing is shown until the user is signed in.
 * Self-contained — injects its own styles, so it works on any page regardless
 * of that page's CSS. Single sign-on: because every page shares the same
 * Supabase session (same origin → shared localStorage), logging in on one
 * page unlocks all of them.
 *
 * SECURITY NOTE: this is a UX gate, not real access control. A static site
 * can't truly hide its source. Actual data protection comes from Supabase
 * Row-Level Security. See supabase.sql.
 *
 * Usage — add to <head> of any page, after config.js + auth.js:
 *   <script src="shared/auth-gate.js"></script>
 *   <script>AuthGate.protect();</script>
 */

const AuthGate = (() => {
  let _mode = 'signin';
  let _gate = null;

  // Hide page content immediately to prevent a flash before auth resolves.
  const _hideStyle = document.createElement('style');
  _hideStyle.id = 'auth-gate-hide';
  _hideStyle.textContent =
    'body{visibility:hidden!important}' +
    'html.auth-gate-ready body{visibility:visible!important}';
  (document.head || document.documentElement).appendChild(_hideStyle);

  function _injectStyles() {
    if (document.getElementById('auth-gate-style')) return;
    const s = document.createElement('style');
    s.id = 'auth-gate-style';
    s.textContent = `
      #auth-gate {
        position: fixed; inset: 0; z-index: 999999;
        display: flex; align-items: center; justify-content: center;
        padding: 1rem; visibility: visible;
        background: #0f1117;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        color: #e7e9ee;
      }
      #auth-gate * { box-sizing: border-box; }
      .ag-card {
        width: 100%; max-width: 380px;
        background: #1a1d27; border: 1px solid #2b2f3a;
        border-radius: 16px; padding: 2rem;
        box-shadow: 0 20px 60px rgba(0,0,0,.5);
      }
      .ag-brand { font-size: 1.6rem; font-weight: 800; text-align: center; margin: 0 0 .25rem; }
      .ag-brand span { color: #7c6cff; }
      .ag-sub { text-align: center; color: #8b90a0; font-size: .9rem; margin: 0 0 1.5rem; }
      .ag-card h2 { font-size: 1.15rem; margin: 0 0 1.25rem; }
      .ag-field { margin-bottom: 1rem; }
      .ag-field label { display: block; font-size: .8rem; color: #8b90a0; margin-bottom: .35rem; }
      .ag-field input {
        width: 100%; padding: .65rem .8rem; border-radius: 8px;
        background: #0f1117; border: 1px solid #2b2f3a; color: #e7e9ee;
        font-size: .95rem; outline: none;
      }
      .ag-field input:focus { border-color: #7c6cff; }
      .ag-btn {
        width: 100%; padding: .7rem; border: none; border-radius: 8px;
        background: #7c6cff; color: #fff; font-size: .95rem; font-weight: 600;
        cursor: pointer; transition: opacity .15s;
      }
      .ag-btn:hover { opacity: .9; }
      .ag-btn:disabled { opacity: .6; cursor: default; }
      .ag-divider { display: flex; align-items: center; gap: .75rem; margin: 1.25rem 0; color: #8b90a0; font-size: .8rem; }
      .ag-divider::before, .ag-divider::after { content: ""; flex: 1; height: 1px; background: #2b2f3a; }
      .ag-btn-ghost {
        width: 100%; padding: .7rem; border-radius: 8px;
        background: transparent; border: 1px solid #2b2f3a; color: #e7e9ee;
        font-size: .95rem; font-weight: 600; cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: .5rem;
        transition: border-color .15s;
      }
      .ag-btn-ghost:hover { border-color: #7c6cff; }
      .ag-btn-ghost + .ag-btn-ghost { margin-top: .6rem; }
      .ag-toggle { text-align: center; font-size: .85rem; color: #8b90a0; margin: 1.25rem 0 0; }
      .ag-toggle a { color: #7c6cff; cursor: pointer; text-decoration: none; }
      .ag-msg { border-radius: 8px; padding: .6rem .8rem; font-size: .85rem; margin-bottom: 1rem; }
      .ag-msg.err { background: rgba(255,90,90,.12); border: 1px solid #ff5a5a; color: #ff8c8c; }
      .ag-msg.ok  { background: rgba(70,200,120,.12); border: 1px solid #46c878; color: #6fe0a0; }
      .ag-hidden { display: none !important; }
    `;
    document.head.appendChild(s);
  }

  function _build() {
    _injectStyles();
    const el = document.createElement('div');
    el.id = 'auth-gate';
    el.innerHTML = `
      <div class="ag-card">
        <p class="ag-brand">Plot<span>Pot</span></p>
        <p class="ag-sub">Sign in to start building your worlds</p>

        <div id="ag-msg" class="ag-msg ag-hidden"></div>

        <form id="ag-form" novalidate>
          <div class="ag-field">
            <label for="ag-email">Email</label>
            <input id="ag-email" type="email" autocomplete="email" placeholder="you@example.com" required />
          </div>
          <div class="ag-field">
            <label for="ag-password">Password</label>
            <input id="ag-password" type="password" autocomplete="current-password" placeholder="••••••••" required />
          </div>
          <button type="submit" class="ag-btn" id="ag-submit">Sign in</button>
        </form>

        <div class="ag-divider"><span>or</span></div>

        <button type="button" class="ag-btn-ghost" id="ag-google-btn">
          <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>
          Continue with Google
        </button>

        <button type="button" class="ag-btn-ghost" id="ag-github-btn">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          Continue with GitHub
        </button>

        <p class="ag-toggle">
          <span id="ag-toggle-text">Don't have an account?</span>
          <a id="ag-toggle-link">Sign up</a>
        </p>
      </div>
    `;
    return el;
  }

  function _setMode(mode) {
    _mode = mode;
    _gate.querySelector('#ag-submit').textContent      = mode === 'signin' ? 'Sign in' : 'Sign up';
    _gate.querySelector('#ag-toggle-text').textContent = mode === 'signin' ? "Don't have an account?" : 'Already have one?';
    _gate.querySelector('#ag-toggle-link').textContent = mode === 'signin' ? 'Sign up' : 'Sign in';
    _gate.querySelector('#ag-password').autocomplete   = mode === 'signin' ? 'current-password' : 'new-password';
    _msg(null);
  }

  function _msg(text, kind = 'err') {
    const m = _gate.querySelector('#ag-msg');
    if (!text) { m.classList.add('ag-hidden'); return; }
    m.textContent = text;
    m.className = 'ag-msg ' + kind;
  }

  function _show() {
    if (document.getElementById('auth-gate')) return;
    _gate = _build();
    document.documentElement.appendChild(_gate);
    document.documentElement.classList.add('auth-gate-ready'); // reveal (gate covers everything anyway)

    _gate.querySelector('#ag-toggle-link').onclick = () =>
      _setMode(_mode === 'signin' ? 'signup' : 'signin');

    // A rejected OAuth request returns an error instead of redirecting. Say so —
    // otherwise the button looks simply dead.
    const _oauth = (btnId, fn, label) => {
      const btn = _gate.querySelector(btnId);
      btn.onclick = async () => {
        _msg(null);
        btn.disabled = true;
        const { error } = (await fn()) || {};
        btn.disabled = false;
        if (error) _msg(error.message, 'err');
        else _msg('Redirecting to ' + label + '…', 'ok');
      };
    };
    _oauth('#ag-google-btn', Auth.signInWithGoogle, 'Google');
    _oauth('#ag-github-btn', Auth.signInWithGitHub, 'GitHub');

    // Surface a failure carried over from a redirect that came back empty-handed.
    const carried = Auth.getLastError?.();
    if (carried) _msg(carried, 'err');

    _gate.querySelector('#ag-form').addEventListener('submit', async e => {
      e.preventDefault();
      _msg(null);
      const email = _gate.querySelector('#ag-email').value.trim();
      const password = _gate.querySelector('#ag-password').value;
      const btn = _gate.querySelector('#ag-submit');
      btn.disabled = true;
      btn.textContent = _mode === 'signin' ? 'Signing in…' : 'Signing up…';

      const fn = _mode === 'signin' ? Auth.signIn : Auth.signUp;
      const { error } = await fn(email, password);

      btn.disabled = false;
      btn.textContent = _mode === 'signin' ? 'Sign in' : 'Sign up';

      if (error) {
        _msg(error.message, 'err');
      } else if (_mode === 'signup') {
        _msg('Account created. If email confirmation is on, check your inbox, then sign in.', 'ok');
        _setMode('signin');
        _msg('Account created. Now sign in.', 'ok');
      }
      // on successful sign-in, onChange removes the gate automatically
    });
  }

  function _hide() {
    if (_gate) { _gate.remove(); _gate = null; }
    document.documentElement.classList.add('auth-gate-ready'); // reveal page content
  }

  async function protect() {
    if (!Auth.isConfigured()) {
      // No backend configured — fail safe by showing the gate with a notice
      await Auth.init();
      _show();
      _msg('Login is not configured yet (shared/config.js).', 'err');
      return;
    }
    await Auth.init();
    Auth.onChange(({ user }) => {
      if (user) _hide();
      else _show();
    });
  }

  return { protect };
})();

window.AuthGate = AuthGate;
