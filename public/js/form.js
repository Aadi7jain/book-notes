// form.js — Open Library search + cover preview on the Add Book form.

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const olInput  = document.getElementById("ol-input");
  const olBtn    = document.getElementById("ol-btn");
  const olRes    = document.getElementById("ol-results");
  const fTitle   = document.getElementById("f-title");
  const fAuthor  = document.getElementById("f-author");
  const fIsbn    = document.getElementById("f-isbn");
  const fPages   = document.getElementById("f-pages");
  const fCover   = document.getElementById("cover-preview");

  if (!olBtn) return;

  async function search() {
    const q = olInput.value.trim();
    if (!q) return;

    olBtn.textContent = "Searching...";
    olBtn.disabled    = true;
    olRes.innerHTML   = "";

    try {
      const res  = await fetch("/api/search?q=" + encodeURIComponent(q));
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      if (!data.books || !data.books.length) {
        olRes.innerHTML = '<p class="ol-msg">No results. Try a different search.</p>';
        return;
      }

      olRes.innerHTML = data.books.map(function (b) {
        return '<div class="ol-card"'
          + ' data-isbn="'   + esc(b.isbn)        + '"'
          + ' data-title="'  + esc(b.title)       + '"'
          + ' data-author="' + esc(b.author)      + '"'
          + ' data-pages="'  + (b.page_count||"") + '">'
          + '<img src="' + (b.cover_url || "/images/no-cover.svg") + '" alt="" loading="lazy" />'
          + '<p class="ol-card-title">'  + esc(b.title)  + '</p>'
          + '<p class="ol-card-author">' + esc(b.author) + '</p>'
          + '</div>';
      }).join("");

      olRes.querySelectorAll(".ol-card").forEach(function (card) {
        card.addEventListener("click", function () { fill(card); });
      });

      // Attach per-image error handlers (and handle already-failed images).
      // Use listeners instead of inline onerror so we remain compatible with CSP.
      olRes.querySelectorAll('img').forEach(function (img) {
        if (img.dataset.fallbackAttached) return;
        img.dataset.fallbackAttached = '1';

        img.addEventListener('error', function () {
          if (img.dataset.fallbackDone) return;
          img.dataset.fallbackDone = '1';
          img.src = '/images/no-cover.svg';
        });

        // If image already finished but naturalWidth is 0, treat as broken
        if (img.complete && img.naturalWidth === 0) img.dispatchEvent(new Event('error'));
      });

    } catch (err) {
      olRes.innerHTML = '<p class="ol-msg" style="color:var(--red)">Search failed. Check your connection.</p>';
    } finally {
      olBtn.textContent = "Search";
      olBtn.disabled    = false;
    }
  }

  function fill(card) {
    if (fTitle)  fTitle.value  = card.dataset.title;
    if (fAuthor) fAuthor.value = card.dataset.author;
    if (fPages && card.dataset.pages) fPages.value = card.dataset.pages;
    if (fIsbn) {
      fIsbn.value = card.dataset.isbn;
      updateCover(card.dataset.isbn);
    }
    olRes.querySelectorAll(".ol-card").forEach(function (c) {
      c.style.borderColor = "";
    });
    card.style.borderColor = "var(--accent)";
  }

  function updateCover(isbn) {
    if (!fCover) return;
    fCover.src = isbn && isbn.trim()
      ? "https://covers.openlibrary.org/b/isbn/" + isbn.trim() + "-M.jpg"
      : "/images/no-cover.svg";
  }

  if (fIsbn) {
    fIsbn.addEventListener("input", function () {
      updateCover(this.value);
    });
  }

  olBtn.addEventListener("click", search);
  olInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); search(); }
  });

  function esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Add a global image error handler (capture phase) so dynamically inserted
  // cover images that fail to load will fallback to the local placeholder.
  // This avoids using inline `onerror` attributes which are blocked by CSP.
  document.addEventListener('error', function (ev) {
    const el = ev.target;
    if (!el || el.tagName !== 'IMG') return;
    try {
      if (el.dataset.fallbackDone) return;
      if (el.src && el.src.includes('/images/no-cover.svg')) return;
      el.dataset.fallbackDone = '1';
      el.src = '/images/no-cover.svg';
    } catch (e) {
      // silent
    }
  }, true);

});