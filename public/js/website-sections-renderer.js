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

function ctaLink(text, href) {
  const a = document.createElement("a");
  a.className = "hero-btn-primary";
  a.textContent = text;
  a.href = href || "#";
  return a;
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
  if (d.buttonText && d.buttonLink) section.appendChild(ctaLink(d.buttonText, d.buttonLink));
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
  d.images.forEach((url) => {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    grid.appendChild(img);
  });
  section.appendChild(grid);
  return section;
}

function renderTestimonialsSection(d) {
  if (!Array.isArray(d.items) || d.items.length === 0) return null;
  const section = document.createElement("section");
  section.className = "admission-section";
  section.appendChild(sectionTitle("What Our Students Say"));
  const grid = document.createElement("div");
  grid.className = "ws-testimonial-grid";
  d.items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "ws-testimonial-card";
    if (item.photo) {
      const img = document.createElement("img");
      img.src = item.photo;
      img.alt = item.name || "";
      card.appendChild(img);
    }
    const name = document.createElement("strong");
    name.textContent = item.name || "";
    const review = document.createElement("p");
    review.textContent = item.review || "";
    card.appendChild(name);
    card.appendChild(review);
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
  if (d.description) { const p = document.createElement("p"); p.textContent = d.description; section.appendChild(p); }
  if (d.buttonText && d.buttonLink) section.appendChild(ctaLink(d.buttonText, d.buttonLink));
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