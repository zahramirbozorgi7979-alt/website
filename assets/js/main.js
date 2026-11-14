// Everlight Homes — small interaction layer (no dependencies)

(function () {
  "use strict";

  // ---- mobile menu -------------------------------------------------------
  var toggle = document.getElementById("navToggle");
  var nav = document.getElementById("mainNav");

  function closeNav() {
    if (!nav || !toggle) return;
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open menu");
  }

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });

    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) closeNav();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeNav();
    });
  }

  // ---- header elevation on scroll ---------------------------------------
  var header = document.getElementById("siteHeader");

  function onScroll() {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ---- active nav link ----------------------------------------------------
  var navLinks = Array.prototype.slice.call(
    document.querySelectorAll(".main-nav a[href^='#']")
  );

  if (navLinks.length) {
    navLinks.forEach(function (link) {
      link.addEventListener("click", function () {
        navLinks.forEach(function (other) {
          other.classList.toggle("is-active", other === link);
        });
      });
    });
  }

  // ---- save (heart) buttons ----------------------------------------------
  document.querySelectorAll(".save-btn").forEach(function (button) {
    button.addEventListener("click", function () {
      var saved = button.classList.toggle("is-saved");
      button.setAttribute("aria-pressed", saved ? "true" : "false");
    });
  });

  // ---- search form --------------------------------------------------------
  var form = document.getElementById("searchForm");
  var note = document.getElementById("searchNote");

  if (form && note) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var selects = Array.prototype.slice.call(form.querySelectorAll("select"));
      var chosen = selects
        .map(function (select) { return select.value; })
        .filter(function (value, index) {
          return index === 0 ? value !== "Any Location" : index === 1 ? value !== "Any Type" : value !== "Any Budget";
        });

      note.textContent = chosen.length
        ? "Showing homes: " + chosen.join(" · ")
        : "Showing all available homes.";
      note.classList.add("is-visible");

      window.clearTimeout(note.hideTimer);
      note.hideTimer = window.setTimeout(function () {
        note.classList.remove("is-visible");
      }, 4000);
    });
  }
})();
