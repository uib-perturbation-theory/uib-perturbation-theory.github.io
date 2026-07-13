(() => {
  "use strict";

  const NEWS_URL = "news.html";
  const MAX_ITEMS = 2;
  const container = document.getElementById("latest-news");

  if (!container) {
    return;
  }

  const normaliseUrl = (value) => {
    if (!value) {
      return "news.html";
    }

    try {
      return new URL(value, window.location.href).href;
    } catch {
      return value;
    }
  };

  const parseDate = (value) => {
    if (!value) {
      return Number.NEGATIVE_INFINITY;
    }

    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp)
      ? Number.NEGATIVE_INFINITY
      : timestamp;
  };

  const extractModernCards = (documentFragment) => {
    return [...documentFragment.querySelectorAll(".news-card")].map(
      (card, originalIndex) => {
        const time = card.querySelector("time");
        const category =
          card.querySelector(".news-card-meta span")?.textContent.trim() ||
          "News";

        return {
          originalIndex,
          href: card.getAttribute("href") || "news.html",
          category,
          datetime:
            time?.getAttribute("datetime") ||
            time?.textContent.trim() ||
            "",
          displayedDate: time?.textContent.trim() || "",
          title: card.querySelector("h2, h3")?.textContent.trim() || "",
          summary: card.querySelector("p")?.textContent.trim() || "",
        };
      }
    );
  };

  const extractLegacyItems = (documentFragment) => {
    return [...documentFragment.querySelectorAll(".news-item")].map(
      (item, originalIndex) => {
        const time = item.querySelector("time");
        const dateElement = item.querySelector(".date");
        const titleLink = item.querySelector("h2 a, h3 a");
        const titleElement = item.querySelector("h2, h3");

        const displayedDate =
          time?.textContent.trim() ||
          dateElement?.textContent.trim() ||
          "";

        return {
          originalIndex,
          href:
            titleLink?.getAttribute("href") ||
            item.querySelector("a")?.getAttribute("href") ||
            "news.html",
          category:
            item.querySelector(".kicker")?.textContent.trim() ||
            "News",
          datetime:
            time?.getAttribute("datetime") ||
            displayedDate,
          displayedDate,
          title: titleElement?.textContent.trim() || "",
          summary: item.querySelector("p")?.textContent.trim() || "",
        };
      }
    );
  };

  const buildNewsItem = (entry) => {
    const article = document.createElement("article");
    article.className = "news-item";

    const time = document.createElement("time");
    time.className = "date";

    if (entry.datetime) {
      time.dateTime = entry.datetime;
    }

    time.textContent = entry.displayedDate || entry.datetime;

    const body = document.createElement("div");

    const category = document.createElement("span");
    category.className = "kicker";
    category.textContent = entry.category;

    const heading = document.createElement("h3");
    const link = document.createElement("a");
    link.href = normaliseUrl(entry.href);
    link.textContent = entry.title;
    heading.appendChild(link);

    body.appendChild(category);
    body.appendChild(heading);

    if (entry.summary) {
      const summary = document.createElement("p");
      summary.textContent = entry.summary;
      body.appendChild(summary);
    }

    article.appendChild(time);
    article.appendChild(body);

    return article;
  };

  const showFallback = () => {
    container.replaceChildren();

    const message = document.createElement("p");
    message.className = "latest-news-status";

    const link = document.createElement("a");
    link.href = NEWS_URL;
    link.textContent = "View the latest news.";

    message.appendChild(link);
    container.appendChild(message);
    container.setAttribute("aria-busy", "false");
  };

  const loadLatestNews = async () => {
    try {
      const response = await fetch(NEWS_URL, {
        cache: "no-store",
        headers: {
          Accept: "text/html",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Could not load ${NEWS_URL}: HTTP ${response.status}`
        );
      }

      const source = await response.text();
      const parsed = new DOMParser().parseFromString(
        source,
        "text/html"
      );

      let entries = extractModernCards(parsed);

      if (entries.length === 0) {
        entries = extractLegacyItems(parsed);
      }

      entries = entries
        .filter((entry) => entry.title)
        .sort((left, right) => {
          const dateDifference =
            parseDate(right.datetime) - parseDate(left.datetime);

          if (dateDifference !== 0) {
            return dateDifference;
          }

          return left.originalIndex - right.originalIndex;
        })
        .slice(0, MAX_ITEMS);

      if (entries.length === 0) {
        throw new Error("No news entries were found in news.html.");
      }

      container.replaceChildren(
        ...entries.map(buildNewsItem)
      );
      container.setAttribute("aria-busy", "false");
    } catch (error) {
      console.error("Latest news could not be loaded.", error);
      showFallback();
    }
  };

  loadLatestNews();
})();
