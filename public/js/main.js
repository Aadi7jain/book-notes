// main.js — client-side live search
// Filters visible book cards as the user types, no server round-trip needed.

(function () {
  const input = document.getElementById("live-search");
  const grid  = document.getElementById("book-grid");
  if (!input || !grid) return;

  input.addEventListener("input", function () {
    const q = this.value.trim().toLowerCase();
    grid.querySelectorAll(".card").forEach(function (card) {
      const match = !q
        || card.dataset.title.includes(q)
        || card.dataset.author.includes(q);
      card.style.display = match ? "" : "none";
    });
  });
})();
