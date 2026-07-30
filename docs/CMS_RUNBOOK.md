# Runbook CMS

Questo runbook descrive la prima infrastruttura sicura del CMS. Le operazioni
Git riguardano esclusivamente il fork
`stefanovaleri-svg/aperitivi-urbani`; l'upstream originale è sempre di sola
lettura.

## 1. Prerequisiti e binding

Usare un progetto Cloudflare Workers con adapter Astro Cloudflare. Copiare
`wrangler.example.jsonc` in `wrangler.jsonc` per lo sviluppo locale e sostituire
gli identificativi placeholder senza committare credenziali.

| Nome | Tipo | Scopo |
| --- | --- | --- |
| `DB` | D1 binding | Dati CMS, stati, revisioni e audit |
| `MEDIA_BUCKET` | R2 binding privato | Upload originali e derivati |
| `CONTENT_SOURCE` | variabile | `markdown` (default) oppure `d1` |
| `PUBLIC_CONTENT_ENABLED` | variabile | Kill switch pubblico; `false` disabilita catalogo, media ed eventi |
| `SITE_CREATOR_HANDLE` | variabile | Identifica il sito/creator corrente |
| `APP_ORIGIN` | variabile | Origine HTTPS canonica, usata dai controlli same-origin |
| `CF_ACCESS_TEAM_URL` | variabile | Origine del team Access, ad esempio `https://team.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | secret | Audience dell'applicazione Access |
| `CMS_BOOTSTRAP_OWNER_EMAILS` | secret | Email iniziali autorizzate, separate da virgola |
| `CMS_WRITES_ENABLED` | variabile | `false` disabilita le mutazioni durante incidenti o rollout |
| `MAX_UPLOAD_BYTES` | variabile | Limite upload; default 8 MiB |
| `EVENT_HASH_SALT` | secret | Sale per pseudonimizzare eventi e sessioni |
| `EVENT_IP_RATE_LIMITER` | Rate Limiting binding | Limite edge per `/api/events`, basato su IP pseudonimizzato e non persistito |

Le chiavi Google e Anthropic sono opzionali. Applicare scope e restrizioni
minime; non sono necessarie per servire il catalogo pubblico.

Il bucket R2 non deve avere un dominio pubblico. I media vengono serviti dalla
route applicativa soltanto quando D1 li marca `ready`, i diritti sono
`approved` e creator, licenza e sito sono attivi. La route usa `no-store` per
rendere effettive le revoche; i media legacy in `public/` non sono idonei al
cutover.

## 2. Cloudflare Access

1. Creare un'applicazione Access self-hosted che copra entrambi i percorsi
   `/admin/*` e `/api/admin/*` dello stesso hostname.
2. Usare una policy Allow limitata al gruppo editoriale e richiedere MFA
   nell'identity provider.
3. Inserire l'origine del team in `CF_ACCESS_TEAM_URL` e l'audience della stessa
   applicazione in `CF_ACCESS_AUD`.
4. Impostare `APP_ORIGIN` sull'origine HTTPS esatta del sito.
5. Impostare temporaneamente `CMS_BOOTSTRAP_OWNER_EMAILS` su una o più email
   verificate. Dopo il primo accesso e la creazione dei principal, ridurre o
   rimuovere la lista bootstrap. Il subject Access è immutabile: un cambio di
   subject richiede una procedura owner esplicita e auditata, non un match email.

Access è il perimetro, non l'unico controllo: il middleware valida anche firma
RS256, issuer, audience, `exp`, `nbf`, subject ed email; D1 applica i ruoli
`owner`, `reviewer` ed `editor`.

## 3. D1 locale e seed

Partire da un database locale vuoto:

```bash
npm ci --include=dev
cp wrangler.example.jsonc wrangler.jsonc
npx wrangler d1 migrations apply DB --local
npm run cms:seed -- --output /tmp/aperitivi-urbani-seed.sql
npx wrangler d1 execute DB --local --file=/tmp/aperitivi-urbani-seed.sql
npm run verify
```

La seed legge `content/locali/`, è deterministica e bootstrap-only. Può essere
rieseguita perché usa insert idempotenti, ma non aggiorna mai righe già presenti:
dopo il primo import D1 è l'unica fonte di verità per governance e contenuti. I
listing importati sono bozze con `creator_approval_status=pending`; creator e
licenza sono rispettivamente `onboarding` e `pending`, il sito è `draft`.

Prima di applicare dati remoti, leggere il file SQL generato e provare l'intero
flusso su D1 locale o preview.

## 4. Migrazione remota

1. Creare D1 e R2 e associare i binding `DB` e `MEDIA_BUCKET` al Worker.
2. Lasciare `CONTENT_SOURCE=markdown` e, durante il provisioning,
   `CMS_WRITES_ENABLED=false`. Le write sono disabilitate anche se la variabile
   è assente o scritta in modo errato.
3. Applicare lo schema:

   ```bash
   npx wrangler d1 migrations apply DB --remote
   ```

4. Generare e revisionare la seed, quindi applicarla:

   ```bash
   npm run cms:seed -- --output /tmp/aperitivi-urbani-seed.sql
   npx wrangler d1 execute DB --remote --file=/tmp/aperitivi-urbani-seed.sql
   ```

5. Verificare conteggi, slug, visite, fonti, attribution, disclosure e media.
6. Abilitare le write con `CMS_WRITES_ENABLED=true`, accedere tramite Access e
   provare il ciclo bozza → review su un record non pubblico.
7. Configurare il binding `EVENT_IP_RATE_LIMITER`, sostituendo il
   `namespace_id` di esempio con un identificatore numerico univoco nel proprio
   account, e una regola Cloudflare WAF/rate-limit aggiuntiva per
   `/api/events`.

Per build e deploy Worker, il file `wrangler.jsonc` deve esistere prima del
build:

```bash
npm run build
npx wrangler deploy
```

Conservare il risultato di `d1 migrations list` e un export/backup D1 prima di
ogni migrazione successiva. Non modificare una migration già applicata:
aggiungerne una nuova.

## 5. Approvazione creator

Per ogni listing candidato alla pubblicazione verificare:

- URL del post o della fonte reale;
- attribution corretta;
- diritto d'uso dei media;
- disclosure commerciale precisa;
- `creator_approval_status=approved`;
- `creator_approved_at` valorizzato con la data dell'approvazione;
- creator `active`, licenza `active` nel proprio intervallo di validità e sito
  `active`;
- almeno un media R2 `ready` con diritti `approved`.

La seed non costituisce approvazione. Un editor può preparare una bozza, ma non
può registrare approvazione, fonte, attribuzione o disclosure in PATCH. Solo
reviewer/owner può approvare diritti e pubblicare. Dopo la pubblicazione la
scheda è immutabile e la revoca media resta sempre disponibile. Questa
foundation non espone ancora un flusso di clonazione/revisione post-pubblicazione:
in caso di correzione urgente usare il kill switch o archiviare la scheda, senza
mutare D1 direttamente, e introdurre il record successore con una modifica
applicativa revisionata.

### Lifecycle creator e sito

Reviewer e owner possono usare i controlli **Lifecycle creator e sito** nella
pagina admin. Ogni modifica richiede la `revision` corrente, incrementa la
revisione e inserisce un record append-only in `audit_logs`; una richiesta con
revisione obsoleta restituisce `409` senza effetti o audit spurii.

Le transizioni applicative consentite sono:

| Entità | Transizioni |
| --- | --- |
| Creator | `prospect → onboarding/archived`; `onboarding → active/paused/archived`; `active ↔ paused`; qualunque stato non terminale → `archived` |
| Licenza | `pending → active/revoked`; `active → expired/revoked`; `expired → active/revoked` |
| Sito | `draft → active/archived`; `active ↔ paused`; qualunque stato non terminale → `archived` |

`revoked` per la licenza e `archived` per creator/sito sono terminali. I trigger
D1 impediscono la riattivazione anche fuori dall'applicazione. Una nuova bozza
crea l'eventuale creator `onboarding` e sito `draft` nello stesso batch D1 di
venue, listing, visita e audit: se una parte fallisce, non restano record
bootstrap orfani.

Le API usate dall'admin sono:

| Metodo | Percorso | Ruolo minimo | Body |
| --- | --- | --- | --- |
| `PATCH` | `/api/admin/creators/:id` | `reviewer` | `revision` e almeno uno tra `status`, `licenseStatus`, `licenseStartsAt`, `licenseEndsAt` |
| `PATCH` | `/api/admin/sites/:id` | `reviewer` | `revision`, `status` |

Le date licenza sono `YYYY-MM-DD` o `null`; la fine, quando presente insieme
all'inizio, deve essere successiva. Entrambe le route richiedono Access,
same-origin, CSRF e `CMS_WRITES_ENABLED=true`.

## 6. Cutover esplicito

Il sito pubblico continua a leggere Markdown finché
`CONTENT_SOURCE=markdown`. Prima del cutover:

1. eseguire `npm run verify`;
2. confrontare numero, slug e campi essenziali dei listing pubblicabili;
3. verificare immagini, mappa, filtri, pagina dettaglio, direzioni e booking in
   preview;
4. controllare approvazioni, attribution e disclosure;
5. migrare tutte le immagini pubblicabili da `public/` a R2 privato, approvarne
   i diritti, rimuovere gli asset legacy dal bundle e predisporre il purge CDN;
6. verificare che nessun listing dipenda da media `legacy_static`;
7. effettuare uno smoke test autenticato del CMS;
8. documentare responsabile e orario del cambio.

Solo allora impostare `CONTENT_SOURCE=d1` e distribuire una nuova versione.
Monitorare errori 4xx/5xx, record mancanti e media non risolti subito dopo il
deploy. Non scrivere contemporaneamente su Markdown e D1.

## 7. Rollback

Il rollback pubblico non distrugge D1 o R2:

1. impostare `CMS_WRITES_ENABLED=false`;
2. se esiste un dubbio su licenza o diritti, impostare immediatamente
   `PUBLIC_CONTENT_ENABLED=false`; non usare Markdown come rollback;
3. solo per incidenti tecnici senza revoche o dubbi sui diritti, e dopo una
   nuova verifica delle fonti, ripristinare `CONTENT_SOURCE=markdown`;
4. distribuire nuovamente e verificare homepage e pagine locale;
5. conservare D1/R2 per diagnosi, senza cancellare o sovrascrivere dati;
6. correggere con una nuova migration o una nuova release, poi ripetere il
   processo di cutover.

Se l'incidente riguarda soltanto l'admin, mantenere il catalogo pubblico e
disabilitare le write. Per una compromissione Access, revocare sessioni/policy
dal pannello Cloudflare e ruotare i secret coinvolti.

## 8. Policy Git del fork

Prima di ogni push:

```bash
git remote -v
git branch --show-current
npm run verify
```

Il solo target di write consentito è
`stefanovaleri-svg/aperitivi-urbani`, tramite branch e pull request verso il suo
`main`. Non usare token runtime, workflow di intake o API applicative per
scrivere su GitHub. Non aprire pull request verso
`robertovalerirv-beep/aperitivi-urbani`.
