(() => {
  "use strict";
  let language = new URLSearchParams(location.search).get("lang");
  if (language !== "ms" && language !== "en") {
    try {
      language = localStorage.getItem("agmx-lang");
    } catch (_) {}
  }
  const originals = new WeakMap();
  function translate() {
    document.documentElement.lang = language === "en" ? "en" : "ms";
    document.querySelectorAll("[data-en]").forEach((el) => {
      if (!originals.has(el)) originals.set(el, el.textContent);
      el.textContent = language === "en" ? el.dataset.en : originals.get(el);
    });
    document.querySelectorAll("[data-tool-lang]").forEach((el) => {
      el.textContent = language === "en" ? "BM" : "EN";
      el.setAttribute(
        "aria-label",
        language === "en" ? "Tukar ke Bahasa Melayu" : "Switch to English",
      );
    });
  }
  window.AGMX_TOOLS = {
    text: (ms, en) => (language === "en" ? en : ms),
    download(blob, filename) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
  translate();
  document.querySelectorAll("[data-tool-lang]").forEach((el) =>
    el.addEventListener("click", () => {
      language = language === "en" ? "ms" : "en";
      try {
        localStorage.setItem("agmx-lang", language);
      } catch (_) {}
      const url = new URL(location.href);
      url.searchParams.set("lang", language);
      history.replaceState(null, "", url);
      translate();
      window.dispatchEvent(new Event("agmx-language"));
    }),
  );
})();
