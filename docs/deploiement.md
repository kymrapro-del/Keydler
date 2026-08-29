# Deploying and connecting

Running it locally takes two commands and is covered in the
[README](../README.md). This page holds the rest: putting it on a host, turning
WebMCP on in a browser, and pointing an agent at it.

### Deploying it

It is live at **https://keydler.com**, served by Cloudflare Pages, with
`www.keydler.com` redirecting to it. The apex is the canonical origin and the
www address must never serve anything: they are two origins, and everything
here is origin-scoped — the
IndexedDB database, the theme preference, "while you were away", the cross-tab
channel, the service worker cache. A log created on one is invisible from the
other, and a `/t/:id` link minted here opens an empty page there. The
origin-trial token is bound to one origin too, so on the wrong one WebMCP never
activates at all.

`vercel.json` carries that redirect. **Cloudflare Pages cannot** — `_redirects`
matches paths, not hosts — so there it is a Redirect Rule set by hand in the
dashboard. Because a forgotten rule is invisible (both addresses answer, each
with its own data), `src/canonical.ts` also sends www to the apex from the page
itself. That is a backstop, not a substitute: a 301 happens before the page
loads, this happens after.

The address moves to `/t/:id` as soon as a task is open, so a host without an
SPA rewrite 404s on every reload, bookmark and shared link. `public/_redirects`
covers Netlify and Cloudflare Pages, `vercel.json` covers Vercel; anything else
needs the equivalent. This is invisible locally — `vite preview` rewrites by
itself, a bare static server does not.

`npm run build` and `npm run build:trial` both run `scripts/precache.mjs`, which
writes the built asset names into `dist/sw.js`, and `scripts/headers.mjs`, which
seals the CSP on the hash of the inline theme script. **`vite build` alone
produces a folder that looks complete and cannot be served**: the policy still
carries `'__CSP_SCRIPT_HASH__'`, which is not a valid source expression, so the
inline script is blocked; and the service worker precaches nothing under a fixed
cache name that never invalidates. Neither is visible in `dist/`.

`npm run artefact` refuses such a folder and names the consequence of each
fault. `check` runs it, so a half-built `dist/` cannot survive a green check.

`dev` serves on `http://localhost:5173`. `check` runs typecheck, lint,
formatting, the full test suite and the production build; `npm run coverage`
adds the coverage report.

```bash
npm run bench
```

`bench` is the scaling harness behind [`docs/echelle.md`](echelle.md).
It is kept out of `npm test` on purpose: it runs for minutes, and a duration is
not an assertion — a time threshold in the suite starts blinking on the first
loaded machine. What the bench finds becomes an ordinary test instead: a node
bound, a token count, a bounded list.

The page works without WebMCP: the state is real and persistent, only the agent
connection is missing.

### Enabling WebMCP

In origin trial since Chrome 149. Locally, no token is needed:

1. open `chrome://flags/#enable-webmcp-testing`
2. set it to **Enabled**
3. restart the browser and reload the page

**Brave works.** Verified on Brave 151 / Chromium 151 on Linux.

For a deployed origin, put a token in `.env`:

```
VITE_WEBMCP_ORIGIN_TRIAL_TOKEN=your-token
```

It is written into the `<head>` at build time, which is the documented route:
`document.modelContext` is an accessor whose existence is decided while the
document is parsed, so a token injected later may unblock nothing.

### Connecting an agent

```bash
npm run trial
```

```bash
brave --remote-debugging-port=9222 --user-data-dir=/tmp/brave-webmcp --enable-features=WebMCP,WebMCPTesting http://localhost:5174
```

```bash
claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest --browserUrl http://127.0.0.1:9222 --categoryExperimentalWebmcp
```

Two non-obvious points: the toggle in `brave://inspect/#remote-debugging` opens
no port, and Chromium ≥ 136 refuses remote debugging on the default profile. The
feature is called `WebMCPTesting` in Brave 151 while `chrome-devtools-mcp`
advertises `WebMCP` — pass both.

The trial build is **required** for a valid run: the dev server serves the whole
source over HTTP, and a browser-only agent can then read the entire project with
`fetch`.
