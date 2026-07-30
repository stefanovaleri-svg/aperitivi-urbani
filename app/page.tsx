"use client";

import { useEffect, useMemo, useState } from "react";

type Venue = {
  slug: string;
  name: string;
  zone: string;
  address: string;
  price: string;
  categories: string[];
  dateLabel: string;
  hook: string;
  summary: string;
  caption: string;
  mentioned: string[];
  instagramUrl: string;
  photos: string[];
  map: { x: number; y: number };
};

const venues: Venue[] = [
  {
    slug: "luceferma",
    name: "Luceferma",
    zone: "Porta Romana",
    address: "Via Amatore Sciesa 6, Milano",
    price: "€",
    categories: ["Cocktail bar", "Bistrot", "Caffetteria"],
    dateLabel: "9 giugno 2026",
    hook: "Arte, design, pensiero e una granita.",
    summary:
      "Un locale che è un po’ museo, ma di quelli che si vivono: caldo, curioso e decisamente fuori formato.",
    caption:
      "Arte, design, pensiero e una granita! Una bella novità: un locale che è un po’ un museo, ma non di quelli polverosi — di quelli che si vivono.",
    mentioned: ["Granita", "Colazione siciliana", "Design"],
    instagramUrl:
      "https://www.instagram.com/p/DZXN3u6DQfI/?img_index=7&igsh=bnhxam9yYzRsZGNv",
    photos: [
      "/images/locali/luceferma/luceferma-1.jpg",
      "/images/locali/luceferma/luceferma-2.jpg",
      "/images/locali/luceferma/luceferma-6.jpg",
      "/images/locali/luceferma/luceferma-8.jpg",
    ],
    map: { x: 68, y: 69 },
  },
  {
    slug: "terrazza-gallia",
    name: "Terrazza Gallia",
    zone: "Stazione Centrale",
    address: "Piazza Duca d’Aosta 9, Milano",
    price: "€€€€",
    categories: ["Cocktail bar", "Bistrot", "Caffetteria"],
    dateLabel: "Data della visita non indicata",
    hook: "Qualche ora di pace e benessere.",
    summary:
      "Un late breakfast luminoso, con lievitati, dolci, creme e perfino il miele prodotto sul tetto del Gallia.",
    caption:
      "Abbiamo partecipato al late breakfast di Terrazza Gallia. Tutto è fatto dal team: lievitati, dolci, creme… perfino il miele è prodotto da arnie sul tetto. Cura e gentilezza da 5 stelle.",
    mentioned: ["Lievitati", "Dolci", "Creme", "Miele"],
    instagramUrl:
      "https://www.instagram.com/reel/DaK6bnqNQ5U/?igsh=MWtnOWY3d205ZDRtYQ%3D%3D",
    photos: [
      "/images/locali/terrazza-gallia/terrazza-gallia-1.jpg",
      "/images/locali/terrazza-gallia/terrazza-gallia-2.jpg",
      "/images/locali/terrazza-gallia/terrazza-gallia-4.jpg",
      "/images/locali/terrazza-gallia/terrazza-gallia-5.jpg",
    ],
    map: { x: 53, y: 22 },
  },
  {
    slug: "zona-locanda-alla-moda",
    name: "Zona — Locanda alla Moda",
    zone: "Porta Romana",
    address: "Via Bergamo 22, Milano",
    price: "€€",
    categories: ["Aperitivo", "Cocktail bar", "Wine bar", "Bistrot"],
    dateLabel: "10 giugno 2026",
    hook: "Sedersi o non sedersi, questo è il dilemma.",
    summary:
      "Un’enoteca con una regola insolita: al momento della visita, consumare ai tavoli alti senza seduta dimezzava il conto.",
    caption:
      "Sedersi o non sedersi, questo è il dilemma. Un locale con prezzi in linea con le enoteche di Milano, ma con una trovata: al momento della visita, bere o mangiare ai tavoli alti senza seduta dava diritto a uno sconto del 50%.",
    mentioned: ["Aperitivo", "Vino", "Formula in piedi"],
    instagramUrl:
      "https://www.instagram.com/reel/DZZvJUYtf_q/?igsh=MXMxYXR5M3F2cWQ0aQ%3D%3D",
    photos: [
      "/images/locali/zona-locanda-alla-moda/zona-locanda-alla-moda-1.jpg",
      "/images/locali/zona-locanda-alla-moda/zona-locanda-alla-moda-3.jpg",
      "/images/locali/zona-locanda-alla-moda/zona-locanda-alla-moda-5.jpg",
      "/images/locali/zona-locanda-alla-moda/zona-locanda-alla-moda-7.jpg",
    ],
    map: { x: 73, y: 78 },
  },
];

const categoryFilters = [
  "Tutti",
  "Aperitivo",
  "Cocktail bar",
  "Bistrot",
  "Caffetteria",
  "Wine bar",
];

const zoneFilters = ["Tutte", "Porta Romana", "Stazione Centrale"];
const priceFilters = ["Tutti", "€", "€€", "€€€€"];

export default function Home() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Tutti");
  const [zone, setZone] = useState("Tutte");
  const [price, setPrice] = useState("Tutti");
  const [urlStateReady, setUrlStateReady] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  const selectedVenue =
    venues.find((venue) => venue.slug === selectedSlug) ?? null;

  const filteredVenues = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("it");

    return venues.filter((venue) => {
      const matchesCategory =
        category === "Tutti" || venue.categories.includes(category);
      const matchesZone = zone === "Tutte" || venue.zone === zone;
      const matchesPrice = price === "Tutti" || venue.price === price;
      const searchable = [
        venue.name,
        venue.zone,
        venue.address,
        venue.hook,
        venue.summary,
        ...venue.categories,
        ...venue.mentioned,
      ]
        .join(" ")
        .toLocaleLowerCase("it");
      const matchesQuery =
        normalizedQuery.length === 0 || searchable.includes(normalizedQuery);

      return matchesCategory && matchesZone && matchesPrice && matchesQuery;
    });
  }, [category, price, query, zone]);

  useEffect(() => {
    const hydrateUrlState = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const requestedCategory = params.get("tipo");
      const requestedZone = params.get("zona");
      const requestedPrice = params.get("prezzo");

      setQuery(params.get("q") ?? "");
      if (requestedCategory && categoryFilters.includes(requestedCategory)) {
        setCategory(requestedCategory);
      }
      if (requestedZone && zoneFilters.includes(requestedZone)) {
        setZone(requestedZone);
      }
      if (requestedPrice && priceFilters.includes(requestedPrice)) {
        setPrice(requestedPrice);
      }
      setUrlStateReady(true);
    }, 0);

    return () => window.clearTimeout(hydrateUrlState);
  }, []);

  useEffect(() => {
    if (!urlStateReady) return;

    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (category !== "Tutti") params.set("tipo", category);
    if (zone !== "Tutte") params.set("zona", zone);
    if (price !== "Tutti") params.set("prezzo", price);
    const nextUrl = params.size
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, "", nextUrl);
  }, [category, price, query, urlStateReady, zone]);

  useEffect(() => {
    if (!selectedVenue) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedSlug(null);
      if (event.key === "ArrowRight") {
        setGalleryIndex((current) =>
          Math.min(current + 1, selectedVenue.photos.length - 1),
        );
      }
      if (event.key === "ArrowLeft") {
        setGalleryIndex((current) => Math.max(current - 1, 0));
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedVenue]);

  function openVenue(slug: string) {
    setGalleryIndex(0);
    setSelectedSlug(slug);
  }

  function resetFilters() {
    setQuery("");
    setCategory("Tutti");
    setZone("Tutte");
    setPrice("Tutti");
  }

  return (
    <main>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="Aperitivi Urbani, home">
          <span>aperitivi</span>
          <span>urbani</span>
        </a>
        <nav className="main-nav" aria-label="Navigazione principale">
          <a href="#esplora">Esplora</a>
          <a href="#mappa">Quartieri</a>
          <a href="#manifesto">La guida</a>
        </nav>
        <a
          className="instagram-link"
          href="https://www.instagram.com/aperitivi_urbani/"
          target="_blank"
          rel="noreferrer"
        >
          Instagram <span aria-hidden="true">↗</span>
        </a>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">La guida ai locali di Milano</p>
          <h1>
            Milano si scopre
            <br />
            anche da un <em>tavolino.</em>
          </h1>
          <p className="hero-intro">
            Le recensioni di Valeria Carbone, trasformate in una guida da
            cercare, filtrare e salvare per la prossima uscita.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#esplora">
              Trova un locale
            </a>
            <a
              className="text-link"
              href="https://www.instagram.com/aperitivi_urbani/"
              target="_blank"
              rel="noreferrer"
            >
              Segui @aperitivi_urbani <span aria-hidden="true">↗</span>
            </a>
          </div>
          <dl className="hero-principles">
            <div>
              <dt>01</dt>
              <dd>Recensioni originali</dd>
            </div>
            <div>
              <dt>02</dt>
              <dd>Inviti dichiarati</dd>
            </div>
            <div>
              <dt>03</dt>
              <dd>Niente scraping</dd>
            </div>
          </dl>
        </div>

        <div className="hero-collage" aria-label="Una selezione di locali">
          <figure className="hero-photo hero-photo-main">
            <img
              src="/images/locali/zona-locanda-alla-moda/zona-locanda-alla-moda-5.jpg"
              alt="Interno di Zona — Locanda alla Moda, a Porta Romana"
            />
            <figcaption>
              <span>Porta Romana</span>
              Zona — Locanda alla Moda
            </figcaption>
          </figure>
          <figure className="hero-photo hero-photo-top">
            <img
              src="/images/locali/terrazza-gallia/terrazza-gallia-3.jpg"
              alt="Dettaglio del late breakfast di Terrazza Gallia"
            />
          </figure>
          <figure className="hero-photo hero-photo-bottom">
            <img
              src="/images/locali/luceferma/luceferma-6.jpg"
              alt="Dettaglio dell’atmosfera di Luceferma"
            />
          </figure>
          <span className="collage-note">Visto, provato, raccontato.</span>
        </div>
      </section>

      <section className="marquee" aria-label="Principi editoriali">
        <div>
          <span>Indirizzi veri</span>
          <i aria-hidden="true">✦</i>
          <span>Dritte da salvare</span>
          <i aria-hidden="true">✦</i>
          <span>Milano, quartiere per quartiere</span>
          <i aria-hidden="true">✦</i>
          <span>Trasparenza sempre</span>
        </div>
      </section>

      <section className="discovery section-shell" id="esplora">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Esplora la selezione</p>
            <h2>Che posto cerchi oggi?</h2>
          </div>
          <p>
            Parti da un quartiere, da un’atmosfera o da quella parola che ti è
            rimasta in testa.
          </p>
        </div>

        <div className="filter-panel">
          <label className="search-field">
            <span>Cerca</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Locale, quartiere, atmosfera…"
            />
          </label>

          <div className="filter-row">
            <div className="filter-set">
              <span className="filter-label">Tipo</span>
              <div className="filter-chips" aria-label="Filtra per tipo">
                {categoryFilters.map((filter) => (
                  <button
                    className={category === filter ? "active" : ""}
                    type="button"
                    key={filter}
                    onClick={() => setCategory(filter)}
                    aria-pressed={category === filter}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-set">
              <span className="filter-label">Zona</span>
              <div className="filter-chips" aria-label="Filtra per zona">
                {zoneFilters.map((filter) => (
                  <button
                    className={zone === filter ? "active" : ""}
                    type="button"
                    key={filter}
                    onClick={() => setZone(filter)}
                    aria-pressed={zone === filter}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-set">
              <span className="filter-label">Prezzo</span>
              <div className="filter-chips" aria-label="Filtra per prezzo">
                {priceFilters.map((filter) => (
                  <button
                    className={price === filter ? "active" : ""}
                    type="button"
                    key={filter}
                    onClick={() => setPrice(filter)}
                    aria-pressed={price === filter}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="results-meta" aria-live="polite">
          <p>
            <strong>{filteredVenues.length}</strong>{" "}
            {filteredVenues.length === 1 ? "locale trovato" : "locali trovati"}
          </p>
          {(query ||
            category !== "Tutti" ||
            zone !== "Tutte" ||
            price !== "Tutti") && (
            <button type="button" onClick={resetFilters}>
              Azzera filtri
            </button>
          )}
        </div>

        {filteredVenues.length > 0 ? (
          <div className="venue-grid">
            {filteredVenues.map((venue, index) => (
              <article className="venue-card" key={venue.slug}>
                <button
                  className="venue-card-button"
                  type="button"
                  onClick={() => openVenue(venue.slug)}
                  aria-label={`Apri la scheda di ${venue.name}`}
                >
                  <div className="venue-image">
                    <img src={venue.photos[0]} alt="" />
                    <span className="venue-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="disclosure-badge">Invito dichiarato</span>
                  </div>
                  <div className="venue-copy">
                    <div className="venue-kicker">
                      <span>{venue.zone}</span>
                      <span>{venue.price}</span>
                    </div>
                    <h3>{venue.name}</h3>
                    <p className="venue-hook">“{venue.hook}”</p>
                    <p className="venue-summary">{venue.summary}</p>
                    <div className="venue-footer">
                      <span>{venue.categories.slice(0, 2).join(" · ")}</span>
                      <span className="round-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </div>
                  </div>
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p className="eyebrow">Nessun risultato</p>
            <h3>Prova una ricerca un po’ più larga.</h3>
            <button className="button button-primary" onClick={resetFilters}>
              Mostra tutti i locali
            </button>
          </div>
        )}
      </section>

      <section className="map-section section-shell" id="mappa">
        <div className="map-copy">
          <p className="eyebrow">Milano, a colpo d’occhio</p>
          <h2>Due quartieri, tre modi di fermarsi.</h2>
          <p>
            La collezione è ancora piccola, quindi la mappa non finge di essere
            completa. Mostra esattamente ciò che è già stato pubblicato e
            revisionato.
          </p>
          <div className="map-legend">
            <span>
              <i className="legend-dot legend-dot-orange" />
              Porta Romana
            </span>
            <span>
              <i className="legend-dot legend-dot-gold" />
              Stazione Centrale
            </span>
          </div>
        </div>

        <div
          className="city-map"
          role="img"
          aria-label="Mappa illustrata dei tre locali recensiti a Milano"
        >
          <span className="map-label map-label-central">Centrale</span>
          <span className="map-label map-label-duomo">Duomo</span>
          <span className="map-label map-label-romana">Porta Romana</span>
          <span className="map-road map-road-one" />
          <span className="map-road map-road-two" />
          <span className="map-road map-road-three" />
          {venues.map((venue, index) => (
            <button
              className={`map-pin ${
                venue.zone === "Stazione Centrale" ? "map-pin-gold" : ""
              }`}
              style={{ left: `${venue.map.x}%`, top: `${venue.map.y}%` }}
              type="button"
              key={venue.slug}
              onClick={() => openVenue(venue.slug)}
              aria-label={`Apri ${venue.name}`}
            >
              <span>
                <b>{index + 1}</b>
              </span>
              <small>{venue.name}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="manifesto" id="manifesto">
        <div className="manifesto-image">
          <img
            src="/images/locali/luceferma/luceferma-2.jpg"
            alt="Un dettaglio del locale Luceferma"
          />
        </div>
        <div className="manifesto-copy">
          <p className="eyebrow">La guida, non l’algoritmo</p>
          <h2>Le dritte che salvi su Instagram, finalmente in ordine.</h2>
          <p className="manifesto-lead">
            Aperitivi Urbani nasce dalle recensioni pubblicate da Valeria
            Carbone e le rende facili da ritrovare: per zona, tipo di locale e
            fascia di prezzo.
          </p>
          <ul>
            <li>
              <span>01</span>
              <div>
                <strong>Fonte chiara</strong>
                <p>Ogni scheda rimanda al post originale.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Trasparenza editoriale</strong>
                <p>Inviti e collaborazioni restano sempre visibili.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Archivio umano</strong>
                <p>Nessuno scraping e nessun testo inventato.</p>
              </div>
            </li>
          </ul>
          <a
            className="button button-light"
            href="https://www.instagram.com/aperitivi_urbani/"
            target="_blank"
            rel="noreferrer"
          >
            Vai al profilo Instagram <span aria-hidden="true">↗</span>
          </a>
        </div>
      </section>

      <footer className="site-footer">
        <a className="wordmark footer-wordmark" href="#top">
          <span>aperitivi</span>
          <span>urbani</span>
        </a>
        <p>
          Le recensioni di locali milanesi di Valeria Carbone.
          <br />
          Contenuti riprodotti su licenza dell’autrice.
        </p>
        <div className="footer-links">
          <a href="#esplora">Esplora</a>
          <a href="#mappa">Quartieri</a>
          <a
            href="https://www.instagram.com/aperitivi_urbani/"
            target="_blank"
            rel="noreferrer"
          >
            Instagram ↗
          </a>
        </div>
      </footer>

      {selectedVenue && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelectedSlug(null);
          }}
        >
          <section
            className="venue-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="venue-modal-title"
          >
            <button
              className="modal-close"
              type="button"
              onClick={() => setSelectedSlug(null)}
              aria-label="Chiudi la scheda"
              autoFocus
            >
              <span aria-hidden="true">×</span>
            </button>

            <div className="modal-gallery">
              <div className="modal-image-main">
                <img
                  src={selectedVenue.photos[galleryIndex]}
                  alt={`${selectedVenue.name}, foto ${galleryIndex + 1} di ${
                    selectedVenue.photos.length
                  }`}
                />
                <span>
                  {galleryIndex + 1} / {selectedVenue.photos.length}
                </span>
              </div>
              <div className="modal-thumbnails">
                {selectedVenue.photos.map((photo, index) => (
                  <button
                    className={galleryIndex === index ? "active" : ""}
                    type="button"
                    key={photo}
                    onClick={() => setGalleryIndex(index)}
                    aria-label={`Mostra foto ${index + 1}`}
                    aria-pressed={galleryIndex === index}
                  >
                    <img src={photo} alt="" />
                  </button>
                ))}
              </div>
            </div>

            <div className="modal-content">
              <div className="modal-meta">
                <span>{selectedVenue.zone}</span>
                <span>{selectedVenue.price}</span>
                <span>Invito dichiarato</span>
              </div>
              <h2 id="venue-modal-title">{selectedVenue.name}</h2>
              <p className="modal-hook">“{selectedVenue.hook}”</p>
              <p className="modal-summary">{selectedVenue.summary}</p>

              <div className="modal-facts">
                <div>
                  <span>Tipo</span>
                  <strong>{selectedVenue.categories.join(" · ")}</strong>
                </div>
                <div>
                  <span>Indirizzo</span>
                  <strong>{selectedVenue.address}</strong>
                </div>
                <div>
                  <span>Visita</span>
                  <strong>{selectedVenue.dateLabel}</strong>
                </div>
              </div>

              <div className="mentioned">
                <span>Nel racconto</span>
                <div>
                  {selectedVenue.mentioned.map((item) => (
                    <small key={item}>{item}</small>
                  ))}
                </div>
              </div>

              <blockquote>{selectedVenue.caption}</blockquote>

              <div className="disclosure-note">
                <strong>Trasparenza</strong>
                <p>
                  Il post originale dichiara un invito. La segnalazione resta
                  visibile qui per mantenere il contesto editoriale.
                </p>
              </div>

              <div className="modal-actions">
                <a
                  className="button button-primary"
                  href={selectedVenue.instagramUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Leggi il post originale ↗
                </a>
                <a
                  className="text-link text-link-dark"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    selectedVenue.address,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Apri in Google Maps ↗
                </a>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
