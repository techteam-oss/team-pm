# Team PM

Internal ClickUp-style project management tool for a 10–15 person team.
React + Vite single-page app, hosted free on GitHub Pages (`https://techteam-oss.github.io/team-pm/`), embedded in a GoHighLevel funnel page with an iframe.
Data, login and files live in the Supabase project **team-pm** (`oxcoqixujubjiasimmwm`, Mumbai).

## Status: Phase 0 (setup and embed proof)

- Email + password login (invite-only), forgot password, set-password screen for invite and reset links
- Hash routing (`#/...`) so the app never fights GoHighLevel over the page URL
- Light / dark / system theme, saved per user in `profiles.theme`
- Database: `profiles`, `workspaces`, `workspace_members` with Row Level Security on every table
  (`supabase/migrations/`), plus `create_workspace()` that makes the caller the owner

Spaces, lists, tasks and the board come in Phases 1–2.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # outputs dist/
```

`.env` holds the Supabase URL and **publishable** key. These are public by design; RLS is what protects data.
Never add the `service_role` / secret key to this repo or the frontend.

## One-time setup

### 1. Supabase Auth settings (dashboard → Authentication)
- **Sign In / Providers → Email:** keep enabled, turn **off** "Allow new users to sign up".
- **URL Configuration → Site URL:** `https://techteam-oss.github.io/team-pm/`
- **URL Configuration → Redirect URLs:** add `https://techteam-oss.github.io/team-pm/**`
- **Add the first user:** Authentication → Users → "Invite user" (or "Add user" with a password).
  They open the app, sign in, and create the workspace; they become its owner.

### 2. Hosting: GitHub Pages (free)
- `.github/workflows/deploy.yml` builds and deploys on every push to `main`.
- One-time: repo Settings → Pages → Source: **GitHub Actions**.
- App URL: `https://techteam-oss.github.io/team-pm/`
- (Cloudflare Pages also works: Vite preset, `npm run build`, output `dist`, `NODE_VERSION=22`.)

### 3. GoHighLevel funnel
- Create a funnel step with no header/footer, section and row padding 0, full width.
- Add a **Custom Code / HTML** element and paste:

```html
<iframe src="https://techteam-oss.github.io/team-pm/" style="width:100%;height:100vh;border:0;display:block" allow="clipboard-write"></iframe>
<style>body{margin:0}</style>
```

Phase 0 is done when a test user can sign in inside that GHL page on Chrome, Safari and a phone.

## Security

The funnel page is public. Login + RLS are the only gate:
- RLS is enabled on every table; anonymous users can read nothing.
- Run Supabase **Advisors → Security** after every database change.
- Optional hardening once the funnel domain is known: add `Content-Security-Policy: frame-ancestors <funnel domain>` to `public/_headers` so only your GHL page can frame the app.
