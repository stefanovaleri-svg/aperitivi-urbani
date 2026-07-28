# Aperitivi Urbani — istruzioni di progetto

## Ambito

Questo è il fork di lavoro
`stefanovaleri-svg/aperitivi-urbani`. Il repository originale
`robertovalerirv-beep/aperitivi-urbani` è upstream di sola lettura e deve
rimanere sempre intatto.

Ogni modifica va fatta su un branch del fork e proposta con pull request verso
`main` del fork. Non creare branch, commit, tag, release o pull request nel
repository originale. Prima di qualsiasi write remoto verificare:

```bash
git remote -v
git branch --show-current
```

## Prodotto e fonti

Il sito indicizza esperienze reali raccontate da creator, a partire da
`@aperitivi_urbani`. Non è una piattaforma di recensioni anonime.

- Non fare scraping di Instagram.
- Ogni listing deve avere una fonte creator reale, attribuzione e approvazione
  esplicita prima della pubblicazione.
- Non inventare prezzi, voti, disclosure, diritti o consensi.
- Una collaborazione si marca solo quando esiste un segnale esplicito.
- Le chiamate LLM, se configurate, sono solo assistenza editoriale
  autenticata: l'output resta bozza e richiede review umana.

## Architettura

- Astro + adapter Cloudflare, deploy unico su Cloudflare Workers.
- D1 è la fonte CMS normalizzata: creator, siti white-label, locali, listing,
  visite, tassonomia, media, eventi e audit.
- R2 è privato. I media pubblici passano dall'applicazione dopo i controlli di
  stato e diritti.
- Cloudflare Access autentica `/admin/*` e `/api/admin/*`; l'app valida issuer,
  audience, firma e scadenza del JWT Access.
- I ruoli applicativi sono `owner`, `reviewer`, `editor`.
- Le mutazioni admin richiedono same-origin, CSRF, controllo ruolo,
  validazione server-side e audit.
- Il runtime non usa token GitHub e non modifica file o branch.

`CONTENT_SOURCE=markdown` è il default. Markdown è il fallback pubblico
versionato durante la transizione; D1 diventa fonte pubblica solo con un
cutover esplicito. Non introdurre dual-write.

## Regole CMS

- La seed Markdown → D1 è deterministica, idempotente e bootstrap-only: non
  aggiorna righe D1 esistenti.
- I record importati restano `draft` con approval `pending`.
- La pubblicazione richiede URL fonte, attribuzione, approvazione creator e
  timestamp di approvazione.
- Solo reviewer/owner può registrare approvazioni, modificare provenance e
  disclosure, approvare/revocare diritti e pubblicare.
- Le schede pubblicate sono immutabili; le revoche di licenza, sito o media
  interrompono ogni lettura pubblica D1.
- Gli upload accettano solo immagini strutturalmente valide e dimensioni
  consentite, usano chiavi generate dal server e diventano pubblici solo se R2,
  `ready` e con diritti `approved`.
- Non esporre bucket R2, credenziali, token, email o identificatori raw negli
  eventi analytics.
- Conservare gli eventi di intenti come eventi distinti; non trasformarli in
  prenotazioni o conversioni verificate.
- Gli audit log sono append-only.

## Flusso di lavoro

```bash
npm ci --include=dev
npm run verify
```

La CI esegue lo stesso comando. Non aggirare test, type-check, validazione
contenuti o build.

Per D1, Access, R2, seed, cutover e rollback seguire
[`docs/CMS_RUNBOOK.md`](docs/CMS_RUNBOOK.md). Non riattivare la vecchia intake
Issue/GitHub Actions, le password condivise, le funzioni Netlify o le API che
scrivevano direttamente nel repository.

## Variabili e binding

Usare `.env.example` e `wrangler.example.jsonc` come inventario, senza inserire
segreti nel repository. I binding obbligatori per il CMS sono `DB` e
`MEDIA_BUCKET`; le variabili principali sono `CONTENT_SOURCE`,
`CF_ACCESS_TEAM_URL`, `CF_ACCESS_AUD`, `APP_ORIGIN`,
`CMS_BOOTSTRAP_OWNER_EMAILS`, `MAX_UPLOAD_BYTES`, `EVENT_HASH_SALT`,
`PUBLIC_CONTENT_ENABLED` e il binding `EVENT_IP_RATE_LIMITER`.

`GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `ANTHROPIC_API_KEY` e
`ANTHROPIC_MODEL` sono opzionali per le rispettive integrazioni e devono avere
scope minimo.
