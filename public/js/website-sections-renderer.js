// public/js/website-sections-renderer.js
//
// Shared rendering logic for Website Builder sections (Admin -> Website
// Builder). Used by BOTH:
//   - index.html          -- the homepage's own sections (page: "home")
//   - public/site-page.html -- any standalone page an admin creates
//                              (e.g. "gallery"), served at /page/:slug
//
// Kept in one file so a fix/new section type only has to be made once and
// both surfaces get it, instead of two copies drifting apart.
//
// SECURITY NOTE: every renderer below builds its section with DOM APIs
// (createElement + textContent, or setting .src/.href to an admin-
// provided URL) -- never innerHTML of admin-entered text. This is the
// whole point of the Website Builder's fixed-field-per-type design (see
// routes/admin/website-sections.js's header comment): an admin fills in
// plain text/URLs through a form, so there is no markup anywhere in
// `data` to render as HTML in the first place.

const WEBSITE_SECTION_RENDERERS = {
  hero: renderHeroSection, text: renderTextSection, image: renderImageSection,
  image_text: renderImageTextSection, gallery: renderGallerySection,
  testimonials: renderTestimonialsSection, faq: renderFaqSection,
  video: renderVideoSection, cta: renderCtaSection, contact: renderContactSection,
  table: renderTableSection, cards: renderCardsSection,
};

// Fetches sections for `page` (default "home", matching every section
// created before this multi-page feature existed -- see
// routes/admin/website-sections.js's DEFAULT_PAGE) and appends each one
// into `container` in order. Shared by both callers above so the
// fail-quiet behavior (empty/slow/failed fetch = container just stays
// empty, never a broken page) only has to be written once.
async function renderWebsiteSectionsInto(container, page = "home") {
  if (!container) return;
  try {
    const res = await fetch(`/api/website-sections?page=${encodeURIComponent(page)}`);
    const json = await res.json();
    const sections = json?.data || [];
    if (!Array.isArray(sections) || sections.length === 0) return;

    // Explicit sort here, not just a trust that the API already sorted --
    // this is the actual "before rendering" ordering guarantee: whatever
    // order the fetch resolves in, this array's order is what determines
    // on-page order below. Ascending by `order` (the "Display Order"
    // field in the Website Builder admin form); missing/null treated as 0
    // so older records without the field don't crash the comparator or
    // sort unpredictably.
    sections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // Tracks the last section inserted at each homepage anchor (e.g.
    // "about"), so a second section also anchored to "about" inserts
    // right after the FIRST one -- not always immediately after the
    // static #about section itself, which would stack multiple sections
    // at the same anchor in reverse order.
    const anchorLastNode = {};

    sections.forEach((s, idx) => {
      const renderFn = WEBSITE_SECTION_RENDERERS[s.type];
      if (!renderFn) return; // unknown/future type -- skip rather than break the page
      const el = renderFn(s.data || {});
      if (!el) return; // renderer decided there's nothing valid to show
      el.id = "section-" + s._id;
      // Alternates background so consecutive sections don't visually blur
      // together (compare e.g. index.html's #about vs #courses, which do
      // the same thing by hand).
      if (idx % 2 === 1) el.classList.add("alt-bg");

      const anchor = s.anchor;
      if (anchor && anchor !== "end") {
        // "home"/"about"/etc. only exist as real elements on index.html
        // itself -- a standalone Website Builder page (site-page.html)
        // has no such ids, so this naturally falls through to the
        // default container append below, no special-casing needed.
        const targetEl = anchorLastNode[anchor] || document.getElementById(anchor);
        if (targetEl) {
          targetEl.insertAdjacentElement("afterend", el);
          anchorLastNode[anchor] = el;
          return;
        }
      }
      container.appendChild(el);
    });
    return sections.length;
  } catch (err) {
    // Fails silently -- an empty/slow/failed fetch should never break the
    // page it's embedded in.
    return 0;
  }
}

function sectionTitle(text) {
  const h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = text;
  return h2;
}

function ctaLink(text, href, icon) {
  const a = document.createElement("a");
  a.className = "hero-btn-primary";
  a.textContent = text;
  a.href = href || "#";
  if (icon) {
    const i = document.createElement("i");
    i.className = "fas " + icon;
    a.prepend(i);
  }
  return a;
}

// Normalizes a section's buttons: new `buttons: [{text, link}]` array, or
// the older singular buttonText/buttonLink shape from before multi-button
// support existed. Returns a wrapper element with every valid button, or
// null if there are none.
function renderButtonsWrap(d, wrapClass) {
  const list = Array.isArray(d.buttons) && d.buttons.length
    ? d.buttons
    : (d.buttonText && d.buttonLink ? [{ text: d.buttonText, link: d.buttonLink }] : []);
  const valid = list.filter((b) => b.text && b.link);
  if (!valid.length) return null;
  const wrap = document.createElement("div");
  wrap.className = wrapClass;
  valid.forEach((b) => wrap.appendChild(ctaLink(b.text, b.link, b.icon)));
  return wrap;
}

function renderHeroSection(d) {
  if (!d.heading) return null;
  const section = document.createElement("section");
  section.className = "admission-section ws-hero";
  if (d.backgroundImage) {
    section.style.backgroundImage = `linear-gradient(rgba(11,31,58,0.72), rgba(11,31,58,0.72)), url("${d.backgroundImage.replace(/"/g, '%22')}")`;
  }
  const h2 = document.createElement("h2");
  h2.className = "ws-hero-heading";
  h2.textContent = d.heading;
  section.appendChild(h2);
  if (d.subHeading) {
    const p = document.createElement("p");
    p.className = "ws-hero-sub";
    p.textContent = d.subHeading;
    section.appendChild(p);
  }
  const btnWrap = renderButtonsWrap(d, "ws-buttons-wrap");
  if (btnWrap) section.appendChild(btnWrap);
  return section;
}

function renderTextSection(d) {
  if (!d.title && !d.description) return null;
  const section = document.createElement("section");
  section.className = "admission-section";
  if (d.title) section.appendChild(sectionTitle(d.title));
  if (d.description) {
    const p = document.createElement("p");
    p.className = "dynamic-section-content";
    p.textContent = d.description;
    section.appendChild(p);
  }
  if (Array.isArray(d.points) && d.points.length) {
    const ul = document.createElement("ul");
    ul.className = "ws-text-points";
    d.points.forEach((point) => {
      const li = document.createElement("li");
      const check = document.createElement("i");
      check.className = "fas fa-check-circle";
      const span = document.createElement("span");
      span.textContent = point;
      li.appendChild(check);
      li.appendChild(span);
      ul.appendChild(li);
    });
    section.appendChild(ul);
  }
  const btnWrap = renderButtonsWrap(d, "ws-text-btn-wrap ws-buttons-wrap");
  if (btnWrap) section.appendChild(btnWrap);
  return section;
}

function renderImageSection(d) {
  if (!d.image) return null;
  const section = document.createElement("section");
  section.className = "admission-section";
  const wrap = document.createElement("div");
  wrap.className = "dynamic-section-content";
  const img = document.createElement("img");
  img.src = d.image;
  img.alt = d.caption || "";
  wrap.appendChild(img);
  if (d.caption) {
    const cap = document.createElement("p");
    cap.style.textAlign = "center";
    cap.style.color = "#6b7280";
    cap.style.fontSize = "13.5px";
    cap.textContent = d.caption;
    wrap.appendChild(cap);
  }
  section.appendChild(wrap);
  return section;
}

function renderImageTextSection(d) {
  if (!d.title && !d.description && !d.image) return null;
  const section = document.createElement("section");
  section.className = "admission-section";
  const row = document.createElement("div");
  row.className = "ws-image-text-row" + (d.imagePosition === "left" ? " ws-image-left" : "");
  const textCol = document.createElement("div");
  textCol.className = "ws-image-text-col";
  if (d.title) { const h3 = document.createElement("h3"); h3.textContent = d.title; textCol.appendChild(h3); }
  if (d.description) { const p = document.createElement("p"); p.textContent = d.description; textCol.appendChild(p); }
  row.appendChild(textCol);
  if (d.image) {
    const imgCol = document.createElement("div");
    imgCol.className = "ws-image-text-col";
    const img = document.createElement("img");
    img.src = d.image;
    img.alt = d.title || "";
    imgCol.appendChild(img);
    row.appendChild(imgCol);
  }
  section.appendChild(row);
  return section;
}

function renderGallerySection(d) {
  if (!Array.isArray(d.images) || d.images.length === 0) return null;
  const section = document.createElement("section");
  section.className = "admission-section";
  const grid = document.createElement("div");
  grid.className = "ws-gallery-grid";
  d.images.forEach((url, idx) => {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    img.style.cursor = "zoom-in";
    img.addEventListener("click", () => openWsGalleryLightbox(d.images, idx));
    grid.appendChild(img);
  });
  section.appendChild(grid);
  return section;
}

// Click-to-enlarge popup for Website Builder gallery images above, with
// left/right arrows (and keyboard Left/Right) to step through the rest of
// that same gallery's photos without closing and reopening. Reuses the
// .lightbox/.lightbox-close CSS already in style.css (loaded by both
// index.html and public/site-page.html). index.html happens to already
// have a #lightbox element + openLightbox()/closeLightbox() of its own
// left over from an older static gallery-grid that no longer exists in
// its HTML, but site-page.html has neither -- so rather than depend on
// that markup being present, this creates its own on first use (once per
// page) with distinct names, working the same way on both surfaces.
let _wsLightboxEl = null;
let _wsLightboxImages = [];
let _wsLightboxIndex = 0;
function ensureWsLightbox() {
  if (_wsLightboxEl) return _wsLightboxEl;
  const box = document.createElement("div");
  box.className = "lightbox";
  box.addEventListener("click", (e) => { if (e.target === box) closeWsGalleryLightbox(); });
  const closeBtn = document.createElement("button");
  closeBtn.className = "lightbox-close";
  closeBtn.innerHTML = "&#x2715;";
  closeBtn.addEventListener("click", closeWsGalleryLightbox);
  const prevBtn = document.createElement("button");
  prevBtn.className = "lightbox-nav lightbox-prev";
  prevBtn.innerHTML = "&#10094;";
  prevBtn.setAttribute("aria-label", "Previous photo");
  prevBtn.addEventListener("click", () => stepWsGalleryLightbox(-1));
  const nextBtn = document.createElement("button");
  nextBtn.className = "lightbox-nav lightbox-next";
  nextBtn.innerHTML = "&#10095;";
  nextBtn.setAttribute("aria-label", "Next photo");
  nextBtn.addEventListener("click", () => stepWsGalleryLightbox(1));
  const img = document.createElement("img");
  img.id = "wsLightboxImg";
  box.appendChild(closeBtn);
  box.appendChild(prevBtn);
  box.appendChild(img);
  box.appendChild(nextBtn);
  document.body.appendChild(box);
  _wsLightboxEl = box;
  document.addEventListener("keydown", (e) => {
    if (!_wsLightboxEl || !_wsLightboxEl.classList.contains("active")) return;
    if (e.key === "ArrowLeft") stepWsGalleryLightbox(-1);
    else if (e.key === "ArrowRight") stepWsGalleryLightbox(1);
    else if (e.key === "Escape") closeWsGalleryLightbox();
  });
  return box;
}
function openWsGalleryLightbox(images, index) {
  const box = ensureWsLightbox();
  _wsLightboxImages = Array.isArray(images) ? images : [images];
  _wsLightboxIndex = index || 0;
  const showNav = _wsLightboxImages.length > 1;
  box.querySelector(".lightbox-prev").style.display = showNav ? "flex" : "none";
  box.querySelector(".lightbox-next").style.display = showNav ? "flex" : "none";
  box.querySelector("#wsLightboxImg").src = _wsLightboxImages[_wsLightboxIndex];
  box.classList.add("active");
  document.body.style.overflow = "hidden";
}
// direction: -1 for previous, 1 for next. Wraps around at both ends.
function stepWsGalleryLightbox(direction) {
  if (!_wsLightboxEl || _wsLightboxImages.length < 2) return;
  _wsLightboxIndex = (_wsLightboxIndex + direction + _wsLightboxImages.length) % _wsLightboxImages.length;
  _wsLightboxEl.querySelector("#wsLightboxImg").src = _wsLightboxImages[_wsLightboxIndex];
}
function closeWsGalleryLightbox() {
  if (!_wsLightboxEl) return;
  _wsLightboxEl.classList.remove("active");
  document.body.style.overflow = "";
}

function renderTestimonialsSection(d) {
  if (!Array.isArray(d.items) || d.items.length === 0) return null;
  const section = document.createElement("section");
  section.className = "admission-section";
  section.appendChild(sectionTitle(d.title || "What Our Students Say"));
  const grid = document.createElement("div");
  grid.className = "ws-testimonial-grid";
  d.items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "ws-testimonial-card";
    if (item.photo) {
      const avatarWrap = document.createElement("div");
      avatarWrap.className = "ws-testimonial-avatar-wrap";
      const img = document.createElement("img");
      img.src = item.photo;
      img.alt = item.name || "";
      avatarWrap.appendChild(img);
      card.appendChild(avatarWrap);
    }
    const name = document.createElement("strong");
    name.className = "ws-testimonial-name";
    name.textContent = item.name || "";
    card.appendChild(name);
    if (item.title) {
      const title = document.createElement("span");
      title.className = "ws-testimonial-title";
      title.textContent = item.title;
      card.appendChild(title);
    }
    const divider = document.createElement("span");
    divider.className = "ws-testimonial-divider";
    card.appendChild(divider);
    if (item.review) {
      const quote = document.createElement("i");
      quote.className = "fas fa-quote-left ws-testimonial-quote-icon";
      card.appendChild(quote);
      const review = document.createElement("p");
      review.className = "ws-testimonial-review";
      review.textContent = item.review;
      card.appendChild(review);
    }
    if (Array.isArray(item.points) && item.points.length) {
      const ul = document.createElement("ul");
      ul.className = "ws-testimonial-points";
      item.points.forEach((point) => {
        const li = document.createElement("li");
        const span = document.createElement("span");
        span.textContent = point;
        li.appendChild(span);
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }
    grid.appendChild(card);
  });
  section.appendChild(grid);
  return section;
}

function renderFaqSection(d) {
  if (!Array.isArray(d.items) || d.items.length === 0) return null;
  const section = document.createElement("section");
  section.className = "admission-section";
  section.appendChild(sectionTitle("Frequently Asked Questions"));
  const wrap = document.createElement("div");
  wrap.className = "ws-faq-wrap";
  d.items.forEach((item) => {
    const details = document.createElement("details");
    details.className = "ws-faq-item";
    const summary = document.createElement("summary");
    summary.textContent = item.question || "";
    const answer = document.createElement("p");
    answer.className = "ws-faq-answer";
    answer.textContent = item.answer || "";
    details.appendChild(summary);
    details.appendChild(answer);
    wrap.appendChild(details);
  });
  section.appendChild(wrap);
  return section;
}

// Accepts a plain YouTube/Vimeo watch URL (what an admin would actually
// paste from their browser's address bar) and converts it to the
// matching embeddable URL. Falls back to using the URL as-is (e.g. it's
// already an /embed/ link, or a direct .mp4) if neither pattern matches.
function toEmbedUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") && u.searchParams.get("v")) {
      return `https://www.youtube.com/embed/${u.searchParams.get("v")}`;
    }
    if (u.hostname === "youtu.be") {
      return `https://www.youtube.com/embed${u.pathname}`;
    }
    if (u.hostname.includes("vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean).pop();
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
  } catch (err) { /* not a parseable URL -- fall through */ }
  return url;
}

function renderVideoSection(d) {
  if (!d.videoUrl) return null;
  const section = document.createElement("section");
  section.className = "admission-section";
  if (d.title) section.appendChild(sectionTitle(d.title));
  const wrap = document.createElement("div");
  wrap.className = "ws-video-wrap";
  const iframe = document.createElement("iframe");
  iframe.src = toEmbedUrl(d.videoUrl);
  iframe.setAttribute("allowfullscreen", "");
  iframe.loading = "lazy";
  wrap.appendChild(iframe);
  section.appendChild(wrap);
  return section;
}

function renderCtaSection(d) {
  if (!d.heading) return null;
  const section = document.createElement("section");
  section.className = "admission-section ws-cta";
  const h2 = document.createElement("h2");
  h2.textContent = d.heading;
  section.appendChild(h2);
  if (d.description) { const p = document.createElement("p"); p.className = "ws-cta-desc"; p.textContent = d.description; section.appendChild(p); }
  const btnWrap = renderButtonsWrap(d, "ws-buttons-wrap");
  if (btnWrap) section.appendChild(btnWrap);
  return section;
}

function renderContactSection(d) {
  if (!d.phone && !d.email && !d.address) return null;
  const section = document.createElement("section");
  section.className = "admission-section";
  if (d.title) section.appendChild(sectionTitle(d.title));
  const wrap = document.createElement("div");
  wrap.className = "ws-contact-wrap";
  [["fa-phone", d.phone], ["fa-envelope", d.email], ["fa-location-dot", d.address]].forEach(([icon, text]) => {
    if (!text) return;
    const row = document.createElement("div");
    row.className = "ws-contact-row";
    const i = document.createElement("i");
    i.className = "fas " + icon;
    const span = document.createElement("span");
    span.textContent = text;
    row.appendChild(i);
    row.appendChild(span);
    wrap.appendChild(row);
  });
  section.appendChild(wrap);
  return section;
}

// Generic data table (e.g. fee structure, batch timings) -- built entirely
// with createElement + textContent per the SECURITY NOTE at the top of
// this file, same as every other renderer. `data.columns` is a flat array
// of header strings, `data.rows` an array of arrays of cell strings, one
// inner array per row, each the same length as `columns` (enforced by
// utils/validators.js's `table` validator before this ever gets saved).
function renderTableSection(d) {
  if (!Array.isArray(d.columns) || d.columns.length === 0) return null;
  if (!Array.isArray(d.rows) || d.rows.length === 0) return null;
  const section = document.createElement("section");
  section.className = "admission-section";
  if (d.title) section.appendChild(sectionTitle(d.title));
  const wrap = document.createElement("div");
  wrap.className = "ws-table-wrap";
  const table = document.createElement("table");
  table.className = "ws-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  d.columns.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  d.rows.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((cell) => {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  wrap.appendChild(table);
  section.appendChild(wrap);
  return section;
}

// Icon-card grid (e.g. course categories, features). `data.items` is an
// array of { icon, title, lines }. The icon is set via the `className`
// *property* (never innerHTML/setAttribute with a template string), so
// even though it's a Font Awesome class name chosen by the admin, there is
// no way for it to be parsed as markup -- same DOM-only guarantee as
// every other renderer in this file.
function renderCardsSection(d) {
  if (!Array.isArray(d.items) || d.items.length === 0) return null;
  const section = document.createElement("section");
  section.className = "admission-section";
  if (d.title) section.appendChild(sectionTitle(d.title));
  if (d.subtitle) {
    const sub = document.createElement("p");
    sub.className = "ws-cards-subtitle";
    sub.textContent = d.subtitle;
    section.appendChild(sub);
  }
  const grid = document.createElement("div");
  grid.className = "ws-icon-cards-grid";
  d.items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "ws-icon-card";
    const iconWrap = document.createElement("div");
    iconWrap.className = "ws-icon-card-icon";
    const i = document.createElement("i");
    i.className = "fas " + (item.icon || "fa-circle");
    iconWrap.appendChild(i);
    card.appendChild(iconWrap);
    const h3 = document.createElement("h3");
    h3.textContent = item.title || "";
    card.appendChild(h3);
    if (item.subtitle) {
      const subtitle = document.createElement("p");
      subtitle.className = "ws-icon-card-subtitle";
      subtitle.textContent = item.subtitle;
      card.appendChild(subtitle);
    }
    if (item.description) {
      const desc = document.createElement("p");
      desc.className = "ws-icon-card-description";
      desc.textContent = item.description;
      card.appendChild(desc);
    }
    const showDivider = item.showDivider !== false; // default true -- keeps old saved cards (no field yet) looking the same
    const lines = item.lines || [];
    if (lines.length) {
      if (showDivider) card.appendChild(document.createElement("hr")).className = "ws-icon-card-divider";
      const ul = document.createElement("ul");
      ul.className = "ws-icon-card-list";
      lines.forEach((line) => {
        const li = document.createElement("li");
        const check = document.createElement("i");
        check.className = "fas fa-check-circle";
        const span = document.createElement("span");
        span.textContent = line;
        li.appendChild(check);
        li.appendChild(span);
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }
    const cardButtons = Array.isArray(item.buttons) && item.buttons.length
      ? item.buttons
      : (item.buttonText && item.buttonLink ? [{ text: item.buttonText, link: item.buttonLink }] : []);
    const validCardButtons = cardButtons.filter((b) => b.text && b.link);
    if (validCardButtons.length) {
      if (showDivider) card.appendChild(document.createElement("hr")).className = "ws-icon-card-divider";
      const btnWrap = document.createElement("div");
      btnWrap.className = "ws-icon-card-btn-wrap";
      validCardButtons.forEach((b) => {
        const btn = ctaLink(b.text, b.link, b.icon || "fa-paper-plane");
        btn.classList.add("ws-icon-card-btn");
        btnWrap.appendChild(btn);
      });
      card.appendChild(btnWrap);
    }
    grid.appendChild(card);
  });
  section.appendChild(grid);
  const sectionBtnWrap = renderButtonsWrap(d, "ws-buttons-wrap ws-cards-btn-wrap");
  if (sectionBtnWrap) section.appendChild(sectionBtnWrap);
  return section;
}