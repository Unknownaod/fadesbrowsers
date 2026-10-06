"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import "./login.css";

/*
 * =========================================================
 * FADES LOGIN  →  app/login/page.js   (served at fades.lol/login)
 * =========================================================
 * Uses the existing auth API (cookie session):
 *   GET  /auth/me      → current user (401 when signed out)
 *   POST /auth/login   → { email, password }
 *   POST /auth/signup  → { username, email, password }
 *
 * If your API expects different field names, change ONLY
 * buildBody() below.
 *
 * Query params:
 *   ?from=browser   shows the "you can close this tab" screen
 *   ?next=/chat     where to go after login (default "/")
 *   ?code=<32 hex>  sign-in handoff from Fades Browser. After login the
 *                   page asks "Connect Fades Browser?" and, on confirm,
 *                   POSTs /auth/browser/link { code } so the browser can
 *                   claim its own token (no shared cookies needed).
 */

const AUTH_API = "https://api.fades.lol/auth";
const LOGO = "/logo.png";
const CODE_RE = /^[a-f0-9]{32}$/;

/* short code shown on both sides so the user can confirm they match */
function formatUserCode(code) {
  const text = code.slice(0, 8).toUpperCase();

  return `${text.slice(0, 4)}-${text.slice(4)}`;
}

function buildBody(mode, { username, email, password }) {
  return mode === "signup"
    ? { username: username.trim(), email: email.trim(), password }
    : { email: email.trim(), password };
}

async function authFetch(path, options = {}) {
  const response = await fetch(`${AUTH_API}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(
      (data && (data.error || data.message)) ||
        (response.status === 401
          ? "Wrong email or password."
          : `Something went wrong (${response.status}).`)
    );

    error.status = response.status;

    throw error;
  }

  return data;
}

function LoginForm() {
  const params = useSearchParams();
  const fromBrowser = params.get("from") === "browser";
  const rawNext = params.get("next") || "/";
  // only allow same-site relative redirects
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const rawCode = params.get("code") || "";
  const code = CODE_RE.test(rawCode) ? rawCode : "";

  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [link, setLink] = useState("idle"); // idle | linking | linked | cancelled
  const [linkError, setLinkError] = useState("");

  const finish = (account) => {
    setUser(account);

    if (!fromBrowser && !code) window.location.assign(next);
  };

  const connectBrowser = async () => {
    setLink("linking");
    setLinkError("");

    try {
      await authFetch("/browser/link", {
        method: "POST",
        body: JSON.stringify({ code }),
      });

      setLink("linked");
    } catch (linkFailure) {
      setLink("idle");
      setLinkError(
        linkFailure.status === undefined
          ? "Can't reach Fades right now. Try again."
          : linkFailure.message
      );
    }
  };

  /* already signed in? */
  useEffect(() => {
    let cancelled = false;

    authFetch("/me")
      .then((data) => {
        const account = data && (data.user || data);

        if (!cancelled && account && (account.id || account.username || account.email)) {
          setUser(account);
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setChecking(false));

    return () => {
      cancelled = true;
    };
  }, []);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();

    if (busy) return;

    setError("");

    if (!form.email.trim() || !form.password) {
      setError("Enter your email and password.");

      return;
    }

    if (mode === "signup") {
      if (!form.username.trim()) {
        setError("Pick a username.");

        return;
      }

      if (form.password.length < 8) {
        setError("Password must be at least 8 characters.");

        return;
      }
    }

    setBusy(true);

    try {
      const data = await authFetch(mode === "signup" ? "/signup" : "/login", {
        method: "POST",
        body: JSON.stringify(buildBody(mode, form)),
      });

      // some APIs return the user, some only set the cookie – confirm with /me
      let account = data && (data.user || (data.id || data.username ? data : null));

      if (!account) {
        const me = await authFetch("/me");

        account = me && (me.user || me);
      }

      finish(account || {});
    } catch (submitError) {
      setError(
        submitError.status === undefined
          ? "Can't reach Fades right now. Check your connection and try again."
          : submitError.message
      );
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    try {
      await authFetch("/logout", { method: "POST" });
    } catch {}

    setUser(null);
  };

  const name = user && (user.username || user.name || user.email || "your account");

  return (
    <main className="fl-page">
      <style>{css}</style>

      <div className="fl-glow fl-glow-1" />
      <div className="fl-glow fl-glow-2" />

      <section className="fl-card">
        <div className="fl-brand">
          <img src={LOGO} alt="" width="40" height="40" />
          <strong>Fades</strong>
        </div>

        {checking ? (
          <div className="fl-center">
            <div className="fl-spinner" />
          </div>
        ) : user && code ? (
          <div className="fl-done">
            {link === "linked" ? (
              <>
                <div className="fl-check">✓</div>

                <h1>Browser connected</h1>

                <p>
                  You're signed in. This tab will close on its own — if it
                  doesn't, you can close it.
                </p>
              </>
            ) : link === "cancelled" ? (
              <>
                <h1>Not connected</h1>

                <p>Nothing was shared with the browser. You can close this tab.</p>
              </>
            ) : (
              <>
                <h1>Connect Fades Browser?</h1>

                <p>
                  Signed in as <b>{name}</b>. Only continue if this code
                  matches the one shown in your browser:
                </p>

                <div className="fl-code">{formatUserCode(code)}</div>

                {linkError && (
                  <div className="fl-error" role="alert">
                    {linkError}
                  </div>
                )}

                <div className="fl-actions">
                  <button
                    className="fl-primary"
                    onClick={connectBrowser}
                    disabled={link === "linking"}
                  >
                    {link === "linking" ? "Connecting…" : "Yes, connect"}
                  </button>

                  <button className="fl-ghost" onClick={() => setLink("cancelled")}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        ) : user ? (
          <div className="fl-done">
            <div className="fl-check">✓</div>

            <h1>You're signed in</h1>

            <p>
              Signed in as <b>{name}</b>.
              {fromBrowser
                ? " You can close this tab and head back to Fades Browser — your sync will pick up automatically."
                : ""}
            </p>

            <div className="fl-actions">
              {!fromBrowser && (
                <button className="fl-primary" onClick={() => window.location.assign(next)}>
                  Continue
                </button>
              )}

              <button className="fl-ghost" onClick={signOut}>
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <>
            <h1>{mode === "login" ? "Welcome back" : "Create your account"}</h1>

            <p className="fl-sub">
              {mode === "login"
                ? "Sign in to sync your bookmarks, history and tabs."
                : "One account for Fades Browser, Chat and Mail."}
            </p>

            <div className="fl-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={mode === "login"}
                className={mode === "login" ? "active" : ""}
                onClick={() => {
                  setMode("login");
                  setError("");
                }}
              >
                Sign in
              </button>

              <button
                role="tab"
                aria-selected={mode === "signup"}
                className={mode === "signup" ? "active" : ""}
                onClick={() => {
                  setMode("signup");
                  setError("");
                }}
              >
                Create account
              </button>
            </div>

            <form onSubmit={submit} noValidate>
              {mode === "signup" && (
                <label>
                  <span>Username</span>

                  <input
                    value={form.username}
                    onChange={set("username")}
                    autoComplete="username"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="yourname"
                  />
                </label>
              )}

              <label>
                <span>Email</span>

                <input
                  type="email"
                  value={form.email}
                  onChange={set("email")}
                  autoComplete="email"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="you@example.com"
                  autoFocus
                />
              </label>

              <label>
                <span>Password</span>

                <div className="fl-password">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={set("password")}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    placeholder={mode === "login" ? "Your password" : "At least 8 characters"}
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </label>

              {error && (
                <div className="fl-error" role="alert">
                  {error}
                </div>
              )}

              <button className="fl-primary" type="submit" disabled={busy}>
                {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
              </button>
            </form>

            <p className="fl-foot">
              {mode === "login" ? "New to Fades? " : "Already have an account? "}

              <button
                type="button"
                onClick={() => {
                  setMode(mode === "login" ? "signup" : "login");
                  setError("");
                }}
              >
                {mode === "login" ? "Create an account" : "Sign in"}
              </button>
            </p>
          </>
        )}
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

const css = `
.fl-page{--accent:#8b7cff;--accent-2:#5ec8ff;position:relative;min-height:100vh;display:grid;place-items:center;padding:24px;background:#0a0a10;color:#f2f2f8;font-family:Inter,"Segoe UI",system-ui,sans-serif;overflow:hidden}
.fl-page *{box-sizing:border-box}
.fl-glow{position:absolute;border-radius:50%;filter:blur(120px);pointer-events:none}
.fl-glow-1{width:480px;height:480px;top:-180px;left:-120px;background:var(--accent);opacity:.3}
.fl-glow-2{width:420px;height:420px;right:-120px;bottom:-180px;background:var(--accent-2);opacity:.18}
.fl-card{position:relative;width:100%;max-width:420px;padding:32px 30px 28px;border-radius:26px;background:rgba(20,20,31,.88);border:1px solid rgba(255,255,255,.12);box-shadow:0 24px 70px rgba(0,0,0,.6);backdrop-filter:blur(18px)}
.fl-brand{display:flex;align-items:center;gap:10px;margin-bottom:22px;font-size:20px;letter-spacing:-.02em}
.fl-brand img{object-fit:contain}
.fl-card h1{margin:0;font-size:26px;letter-spacing:-.03em}
.fl-sub{margin:6px 0 20px;color:#a4a4b8;font-size:14px}
.fl-tabs{display:flex;gap:4px;padding:4px;margin-bottom:18px;border-radius:12px;background:#0f0f18;border:1px solid rgba(255,255,255,.07)}
.fl-tabs button{flex:1;padding:8px;border:0;border-radius:8px;background:none;color:#a4a4b8;font:inherit;font-size:13px;font-weight:500;cursor:pointer}
.fl-tabs button.active{background:rgba(139,124,255,.16);color:#8b7cff;font-weight:700;box-shadow:inset 0 0 0 1px rgba(139,124,255,.45)}
.fl-card form{display:flex;flex-direction:column;gap:14px}
.fl-card label{display:flex;flex-direction:column;gap:6px}
.fl-card label>span{color:#a4a4b8;font-size:12.5px;font-weight:600}
.fl-card input{width:100%;height:44px;padding:0 14px;border-radius:12px;background:#0f0f18;border:1px solid rgba(255,255,255,.12);color:inherit;font:inherit;font-size:14px;outline:none;transition:border-color .2s,box-shadow .2s}
.fl-card input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(139,124,255,.16)}
.fl-password{position:relative}
.fl-password input{padding-right:64px}
.fl-password button{position:absolute;top:50%;right:8px;transform:translateY(-50%);padding:6px 10px;border:0;border-radius:8px;background:none;color:#a4a4b8;font:inherit;font-size:12px;font-weight:600;cursor:pointer}
.fl-password button:hover{color:#f2f2f8}
.fl-error{padding:10px 14px;border-radius:12px;background:rgba(255,92,108,.1);border:1px solid rgba(255,92,108,.4);color:#ff8f9b;font-size:13px}
.fl-primary{height:46px;border:0;border-radius:999px;background:linear-gradient(135deg,var(--accent),#6a5bff);color:#fff;font:inherit;font-weight:600;cursor:pointer;box-shadow:0 6px 18px rgba(139,124,255,.35);transition:filter .15s,transform .15s}
.fl-primary:hover:not(:disabled){filter:brightness(1.1);transform:translateY(-1px)}
.fl-primary:disabled{opacity:.6;cursor:default}
.fl-ghost{height:46px;padding:0 22px;border-radius:999px;background:none;border:1px solid rgba(255,255,255,.14);color:inherit;font:inherit;font-weight:600;cursor:pointer}
.fl-ghost:hover{border-color:var(--accent)}
.fl-foot{margin:18px 0 0;text-align:center;color:#a4a4b8;font-size:13px}
.fl-foot button{padding:0;border:0;background:none;color:var(--accent);font:inherit;font-weight:600;cursor:pointer}
.fl-center{display:grid;place-items:center;padding:40px 0}
.fl-spinner{width:32px;height:32px;border-radius:50%;border:3px solid #232335;border-top-color:var(--accent);animation:fl-spin .8s linear infinite}
.fl-done{text-align:center}
.fl-done p{margin:10px 0 0;color:#a4a4b8;font-size:14px;line-height:1.55}
.fl-done b{color:#f2f2f8}
.fl-check{display:grid;place-items:center;width:56px;height:56px;margin:0 auto 14px;border-radius:50%;background:rgba(61,220,151,.15);color:#3ddc97;font-size:26px;font-weight:700}
.fl-actions{display:flex;justify-content:center;gap:10px;margin-top:22px}
.fl-actions .fl-primary{padding:0 28px}
.fl-done .fl-error{margin-top:12px}
.fl-code{width:max-content;margin:16px auto 4px;padding:12px 22px;border-radius:14px;background:rgba(139,124,255,.16);border:1px dashed rgba(139,124,255,.5);color:#8b7cff;font-size:28px;font-weight:700;letter-spacing:.2em;font-variant-numeric:tabular-nums}
@keyframes fl-spin{to{transform:rotate(360deg)}}
`;