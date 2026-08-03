# Camimangiacose delivery endpoint — the end goal

This file defines the finished delivery state for the Aperitivi Urbani /
camimangiacose influencer-site pipeline, so any agent (Claude, Codex, ChatGPT)
working on this project knows exactly what "done" looks like. Delivered and
verified on 2026-08-03.

## Live production endpoints

| Site | URL | What it is |
| --- | --- | --- |
| Catalogue (SSR) | https://camimangiacose-catalogo.pages.dev | Cloudflare Pages advanced mode (`_worker.js` SSR worker + asset-first wrapper); 2,478 files including ALL 2,464 media assets (1.67 GB); verified routes `/`, `/data`, `/media/*`, hashed CSS/JS |
| Map site (Roberto option) | https://camimangiacose-mappa.pages.dev | Static Cloudflare Pages; 5,580 files including all media (2.4 GB); 880 rendered pages under `/`, `/dati/*`, `/locali/*` |

## Definition of done for any future release

1. Site builds green, including its validation suite.
2. ALL scraped media is present in the deploy — no placeholders, no partial
   media. Contract media rights cover full inclusion (see AGENTS.md).
3. Deployed to Cloudflare free tier by direct upload (`wrangler pages deploy`),
   no Git integration; production URL returns HTTP 200 on the homepage, on a
   data/deep route, and on a sample media file.
4. Source pushed to the site's GitHub repo with the deploy procedure
   documented in-repo.
5. One curated UOS handoff recorded for the delivery.

## Source repositories

- `stefanovaleri-svg/camimangiacose-site-sites-option` — catalogue app.
  `deploy-pages/README.md` documents the zero-copy Pages deploy
  (`build.copyPublicDir: false` + hard-linked media + `_worker.js` wrapper).
- `stefanovaleri-svg/camimangiacose-site-roberto-option` — map site.
  Render-only build (`npm run build:render-only`) + hard-linked media, then
  plain `wrangler pages deploy dist`.

## Cloudflare account facts (no secrets)

- Pages projects: `camimangiacose-catalogo`, `camimangiacose-mappa`
  (production branch `main`, direct upload).
- workers.dev subdomain exists: `stefano-valeri.workers.dev` (per-worker URL
  toggles currently off).
- A stale Worker `camimangiacose-local-catalogue` exists with no URL and no
  static assets — superseded by the Pages deploy; safe to delete, but that is
  a user decision.
- The account owns no registered domains, so the pages.dev URLs are the
  canonical free endpoints. Attaching custom domains requires purchasing a
  domain first (user decision; attachment itself is free).
