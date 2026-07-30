# Aperitivi Urbani

Guida indipendente ai locali raccontati da
[@aperitivi_urbani](https://www.instagram.com/aperitivi_urbani/). Questo
repository è il fork di lavoro `stefanovaleri-svg/aperitivi-urbani`: il
repository originale a monte non viene modificato.

## Architettura

- **Astro su Cloudflare Workers** serve il sito pubblico e le route on-demand.
- **Markdown versionato** in `content/locali/` resta la fonte pubblica
  predefinita durante la transizione. Non è un rollback valido dopo una revoca
  di diritti.
- **Cloudflare D1** contiene il modello CMS normalizzato, revisioni, stati di
  approvazione e audit.
- **Cloudflare R2 privato** contiene i nuovi media; non viene esposto tramite
  dominio pubblico.
- **Cloudflare Access** protegge `/admin/*` e `/api/admin/*`. Non esistono
  password condivise o token GitHub nel runtime.

Il runtime non scrive nel repository. La vecchia intake basata su Issue,
workflow con agent e commit GitHub è stata rimossa.

## Sviluppo locale

Richiede Node.js 24.

```bash
npm ci --include=dev
npm run dev
npm run verify
```

`npm run verify` esegue validazione dei contenuti, test, type-check Astro e
build. Lo stesso comando è obbligatorio in CI per ogni pull request verso
`main`.

Per provare D1 e R2 in locale:

```bash
cp wrangler.example.jsonc wrangler.jsonc
npx wrangler d1 migrations apply DB --local
npm run cms:seed -- --output /tmp/aperitivi-urbani-seed.sql
npx wrangler d1 execute DB --local --file=/tmp/aperitivi-urbani-seed.sql
npm run dev
```

La seed bootstrap importa i contenuti esistenti come bozze, creator
`onboarding`, licenza `pending` e sito `draft`: non pubblica nulla, non inventa
consensi e non sovrascrive mai record D1 già esistenti.

## Report analytics

`npm run analytics -- --days=30 --site=aperitivi-urbani` usa le credenziali
Cloudflare Analytics read-only descritte in `scripts/.env.example`. Per ogni
sito produce in `scripts/out/` il report completo JSON e tre CSV UTF-8
compatibili con i fogli di calcolo: traffico giornaliero, pagine principali e
provenienza. I CSV neutralizzano i valori esterni che potrebbero essere
interpretati come formule.

## Pubblicazione e cutover

`CONTENT_SOURCE=markdown` è il default sicuro. Il passaggio a
`CONTENT_SOURCE=d1` è una scelta operativa esplicita, da fare solo dopo
migrazione dei media legacy nel bucket R2 privato, approvazione dei relativi
diritti, licenza creator valida e smoke test. Per
configurazione, cutover e rollback vedi
[docs/CMS_RUNBOOK.md](docs/CMS_RUNBOOK.md).

## Contribuire

1. Verifica che `origin` sia
   `https://github.com/stefanovaleri-svg/aperitivi-urbani.git`.
2. Crea un branch nel fork.
3. Esegui `npm run verify`.
4. Apri una pull request verso `main` **del fork**.

Non fare push, commit, pull request o automazioni verso
`robertovalerirv-beep/aperitivi-urbani`. Vedi [CLAUDE.md](CLAUDE.md) per gli
invarianti del progetto.
