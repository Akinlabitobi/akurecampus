# Harvesters Akure

Public site, admin dashboard, and outreach call centre for Harvesters Akure.

- `npm run dev` — Vite dev server (frontend)
- `npm run api` — local API server (backend)
- `npm run build` — production build (multi-page: main site + callcentre)

See `.env.example` for required environment variables, and
`callcentre/schema.sql` for the outreach call centre's Supabase schema.

Deployed on Vercel, auto-deploying from the `main` branch on every push.

## Project layout

```
index.html, callcentre/*.html   Vite entry pages
src/
  main.js                       browser app entry: starts it and wires window events
  render.js                     render() and navigate(): draws the current view, binds its events
  pages/                        one module per page (home, communities, giving, profile...)
    dashboard/                  admin dashboard and its tabs (members, cells, broadcast, admins...)
  components/                   shared UI: shell (nav + footer), forms, dialogs, icon, photo picker,
                                install prompt, 3D hero scene
  lib/                          state, router, API calls, member sign-in, formatting, permissions,
                                config, share-meta, communities, offline queue
  callcentre/                   outreach call centre (separate pages, Supabase direct)
  styles.css
server.js                       local server entry: static files + /api, used by api/handler.js on Vercel
server/
  api.js                        sends each /api request to a route group
  routes/                       public, member, cell, admin, broadcast, dashboard
  *.js                          config, db, auth, members, cells, records, csv, photos, messaging, http
```
