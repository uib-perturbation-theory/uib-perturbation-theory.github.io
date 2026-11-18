/* Flip-book reader for the publications library.
   Each paper is a set of page images in assets/books/<slug>/page-NN.webp.
   The page-turn animation uses StPageFlip (https://github.com/Nodlik/StPageFlip). */

(() => {
  "use strict";

  const reader = document.getElementById("reader");

  if (!reader) {
    return;
  }

  const stage = reader.querySelector(".reader-stage");
  const slot = reader.querySelector(".reader-book-slot");
  const titleEl = document.getElementById("reader-title");
  const venueEl = document.getElementById("reader-venue");
  const overviewEl = document.getElementById("reader-overview");
  const sourceEl = document.getElementById("reader-source");
  const counterEl = document.getElementById("reader-counter");
  const closeBtn = reader.querySelector(".reader-close");
  const prevBtns = reader.querySelectorAll("[data-reader-prev]");
  const nextBtns = reader.querySelectorAll("[data-reader-next]");

  // Below two pages of this width the book switches to single-page mode.
  const MIN_PAGE_WIDTH = 280;

  let flip = null;
  let container = null;
  let current = null;
  let openedByPush = false;
  let lastFocus = null;

  const pageUrl = (slug, n) =>
    `assets/books/${slug}/page-${String(n).padStart(2, "0")}.webp`;

  const findArticle = (slug) =>
    document.querySelector(`.book[data-book="${CSS.escape(slug)}"]`);

  const bookFromArticle = (article) => {
    const [pw, ph] = (article.dataset.pageSize || "612x792")
      .split("x")
      .map(Number);
    const q = (selector) => article.querySelector(selector);

    return {
      slug: article.dataset.book,
      pages: Number(article.dataset.pages),
      pw,
      ph,
      ratio: pw / ph,
      title: q(".book-title")?.textContent.trim().replace(/\s+/g, " ") || "",
      venue: q(".book-status span:last-child")?.textContent.trim() || "",
      overview: q(".book-title a")?.getAttribute("href") || "",
      source:
        q('.book-links a[data-kind="journal"]') ||
        q('.book-links a[data-kind="arxiv"]'),
    };
  };

  // Size the slot so the book fits the stage: two pages side by side when
  // there is room, otherwise one page.
  const fit = () => {
    if (!current) {
      return;
    }

    const cs = getComputedStyle(stage);
    const availW =
      stage.clientWidth -
      parseFloat(cs.paddingLeft) -
      parseFloat(cs.paddingRight);
    const availH =
      stage.clientHeight -
      parseFloat(cs.paddingTop) -
      parseFloat(cs.paddingBottom);

    let width = Math.min(availW, availH * 2 * current.ratio);

    if (width < 2 * MIN_PAGE_WIDTH) {
      width = Math.min(availW, availH * current.ratio);
    }

    slot.style.width = `${Math.max(1, Math.floor(width))}px`;
  };

  const spreadInfo = () => {
    const n = current.pages;

    if (!flip) {
      return { label: `${n} pages`, atStart: true, atEnd: true };
    }

    const i = flip.getCurrentPageIndex();

    if (flip.getOrientation() === "portrait") {
      return {
        label: `${i + 1} / ${n}`,
        atStart: i === 0,
        atEnd: i >= n - 1,
      };
    }

    // Landscape with a cover: [0], [1, 2], [3, 4], ...
    if (i === 0) {
      return { label: `1 / ${n}`, atStart: true, atEnd: n === 1 };
    }

    const left = i % 2 === 1 ? i : i - 1;
    const hasRight = left < n - 1;

    return {
      label: hasRight ? `${left + 1}–${left + 2} / ${n}` : `${left + 1} / ${n}`,
      atStart: false,
      atEnd: left + (hasRight ? 1 : 0) >= n - 1,
    };
  };

  const updateControls = () => {
    if (!current) {
      return;
    }

    const info = spreadInfo();
    counterEl.textContent = info.label;
    prevBtns.forEach((btn) => (btn.disabled = info.atStart));
    nextBtns.forEach((btn) => (btn.disabled = info.atEnd));
  };

  const destroyBook = () => {
    if (flip) {
      try {
        flip.destroy();
      } catch {
        /* the block is removed below anyway */
      }
      flip = null;
    }

    container?.remove();
    container = null;
    current = null;
  };

  const open = (article, { push = true } = {}) => {
    if (current) {
      destroyBook();
    }

    current = bookFromArticle(article);

    if (!current.slug || !current.pages) {
      current = null;
      return;
    }

    if (reader.hidden) {
      lastFocus = document.activeElement;
    }

    titleEl.textContent = current.title;
    venueEl.textContent = current.venue;
    overviewEl.href = current.overview;

    if (current.source) {
      sourceEl.href = current.source.href;
      sourceEl.textContent =
        current.source.dataset.kind === "journal" ? "Journal" : "arXiv";
      sourceEl.hidden = false;
    } else {
      sourceEl.hidden = true;
    }

    reader.hidden = false;
    document.documentElement.classList.add("reader-open");

    container = document.createElement("div");
    container.className = "reader-book";
    slot.appendChild(container);
    fit();

    const pages = [];

    for (let n = 1; n <= current.pages; n += 1) {
      const page = document.createElement("div");
      const img = document.createElement("img");

      page.className = "reader-page";
      img.src = pageUrl(current.slug, n);
      img.alt = `Page ${n} of ${current.pages}`;
      img.decoding = "async";
      img.draggable = false;

      if (n > 3) {
        img.fetchPriority = "low";
      }

      page.appendChild(img);
      pages.push(page);
    }

    if (window.St && window.St.PageFlip) {
      flip = new window.St.PageFlip(container, {
        width: current.pw,
        height: current.ph,
        size: "stretch",
        minWidth: MIN_PAGE_WIDTH,
        maxWidth: 4000,
        minHeight: 100,
        maxHeight: 6000,
        showCover: true,
        usePortrait: true,
        autoSize: true,
        drawShadow: true,
        maxShadowOpacity: 0.55,
        flippingTime: 750,
        mobileScrollSupport: false,
      });

      flip.loadFromHTML(pages);
      flip.on("init", updateControls);
      flip.on("flip", updateControls);
      flip.on("changeOrientation", updateControls);
    } else {
      // Library unavailable: show the pages as a scrollable column.
      container.classList.add("reader-fallback");
      pages.forEach((page) => container.appendChild(page));
    }

    updateControls();

    if (push) {
      history.pushState(
        { read: current.slug },
        "",
        `?read=${encodeURIComponent(current.slug)}`
      );
      openedByPush = true;
    }

    closeBtn.focus({ preventScroll: true });
  };

  const close = ({ fromHistory = false } = {}) => {
    if (!current) {
      return;
    }

    destroyBook();
    reader.hidden = true;
    document.documentElement.classList.remove("reader-open");

    if (!fromHistory) {
      if (openedByPush) {
        openedByPush = false;
        history.back();
      } else {
        history.replaceState({}, "", location.pathname + location.hash);
      }
    }

    lastFocus?.focus?.({ preventScroll: true });
  };

  const next = () => flip && flip.flipNext();
  const prev = () => flip && flip.flipPrev();

  // ---------- Events ----------

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-read]");

    if (
      !trigger ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const article = trigger.closest(".book");

    if (article) {
      event.preventDefault();
      open(article);
    }
  });

  closeBtn.addEventListener("click", () => close());
  prevBtns.forEach((btn) => btn.addEventListener("click", prev));
  nextBtns.forEach((btn) => btn.addEventListener("click", next));

  document.addEventListener("keydown", (event) => {
    if (reader.hidden) {
      return;
    }

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "ArrowRight":
      case "PageDown":
        event.preventDefault();
        next();
        break;
      case "ArrowLeft":
      case "PageUp":
        event.preventDefault();
        prev();
        break;
      case "Home":
        if (flip) {
          event.preventDefault();
          flip.turnToPage(0);
          updateControls();
        }
        break;
      case "End":
        if (flip) {
          event.preventDefault();
          flip.turnToPage(current.pages - 1);
          updateControls();
        }
        break;
      case "Tab": {
        // Keep keyboard focus inside the reader.
        const focusable = [
          ...reader.querySelectorAll("a[href]:not([hidden]), button:not([disabled])"),
        ];

        if (!focusable.length) {
          break;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        break;
      }
      default:
        break;
    }
  });

  // Registered before any book exists, so it runs before the library's own
  // resize handler and the library measures the new size.
  window.addEventListener("resize", fit);

  window.addEventListener("popstate", () => {
    const slug = new URLSearchParams(location.search).get("read");
    const article = slug && findArticle(slug);

    if (article) {
      openedByPush = false;
      open(article, { push: false });
    } else {
      close({ fromHistory: true });
    }
  });

  // Direct links such as publications.html?read=<slug>
  const initial = new URLSearchParams(location.search).get("read");
  const initialArticle = initial && findArticle(initial);

  if (initialArticle) {
    open(initialArticle, { push: false });
  }
})();
