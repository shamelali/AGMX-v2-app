/* AGMX Copilot: authenticated, cited answers; explicit demo examples only. */
(function (window, document) {
  "use strict";

  const COPY = {
    EN: {
      intro: "Ask about your organization's indexed governance documents.", live: "Organization knowledge · GraphRAG",
      demo: "Demo example · simulated", demoNote: "This fixed example is simulated. Sign in as an administrator or secretary to query your organization's indexed documents.",
      access: "Administrator or secretary access required", accessNote: "Ask your organization administrator for access to the knowledge workspace.",
      label: "Your question", hint: "Up to 2,000 characters. Each question is answered independently using indexed documents.",
      placeholder: "What do our meeting minutes say about the annual review?", ask: "Ask Copilot", sample: "Show sample answer", retry: "Try again",
      loading: "Searching documents and preparing a cited answer…", cancel: "Cancel", cancelled: "Request cancelled. Your question has been kept.",
      ready: "Ready for your question.", complete: "Answer ready. Review the cited sources below.",
      empty: "Insufficient evidence", emptyNote: "The indexed sources do not support an answer to this question. Try a more specific question or ask staff to index the relevant document.",
      answer: "Answer", fact: "Fact", inference: "Inference", sources: "Sources", source: "Source", page: "Page", noPage: "Page not available",
      untitled: "Untitled document", excerpt: "Source excerpt", quote: "Extracted graph quote", unknowns: "Not established by these sources",
      question: "Question", sampleQuestion: "What does the sample policy require?", sampleClaim: "The sample policy requires an annual review.",
      sampleText: "The sample policy requires an annual review.", sampleTitle: "Sample governance policy (simulated)",
      validation: "Enter a question containing 1 to 2,000 characters.", authentication: "Your session has expired or changed. Log out and sign in again to continue.",
      forbidden: "Knowledge queries require an administrator or secretary account with an active organization.",
      timeout: "The request timed out. Your question has been kept; try again.", network: "Could not reach the knowledge service. Check your connection and try again.",
      unavailable: "The knowledge service is unavailable. Try again later or ask your administrator to check its configuration.",
      invalid_response: "The service returned an incomplete or invalid answer. Try again later.", rate_limit: "Too many requests. Wait a moment, then try again.",
    },
    BM: {
      intro: "Tanya tentang dokumen tadbir urus organisasi anda yang telah diindeks.", live: "Pengetahuan organisasi · GraphRAG",
      demo: "Contoh demo · simulasi", demoNote: "Contoh tetap ini ialah simulasi. Log masuk sebagai pentadbir atau setiausaha untuk bertanya tentang dokumen organisasi anda yang telah diindeks.",
      access: "Akses pentadbir atau setiausaha diperlukan", accessNote: "Minta pentadbir organisasi anda memberikan akses kepada ruang pengetahuan.",
      label: "Soalan anda", hint: "Maksimum 2,000 aksara. Setiap soalan dijawab secara berasingan berdasarkan dokumen yang telah diindeks.",
      placeholder: "Apakah yang dinyatakan dalam minit mesyuarat tentang semakan tahunan?", ask: "Tanya Copilot", sample: "Lihat jawapan contoh", retry: "Cuba semula",
      loading: "Mencari dokumen dan menyediakan jawapan bersumber…", cancel: "Batal", cancelled: "Permintaan dibatalkan. Soalan anda dikekalkan.",
      ready: "Sedia menerima soalan anda.", complete: "Jawapan sedia. Semak sumber rujukan di bawah.",
      empty: "Bukti tidak mencukupi", emptyNote: "Sumber yang diindeks tidak menyokong jawapan untuk soalan ini. Cuba soalan yang lebih khusus atau minta petugas mengindeks dokumen berkaitan.",
      answer: "Jawapan", fact: "Fakta", inference: "Inferens", sources: "Sumber", source: "Sumber", page: "Halaman", noPage: "Halaman tidak tersedia",
      untitled: "Dokumen tanpa tajuk", excerpt: "Petikan sumber", quote: "Petikan graf yang diekstrak", unknowns: "Tidak dapat dipastikan daripada sumber ini",
      question: "Soalan", sampleQuestion: "Apakah yang diperlukan oleh dasar contoh?", sampleClaim: "Dasar contoh memerlukan semakan tahunan.",
      sampleText: "Dasar contoh memerlukan semakan tahunan.", sampleTitle: "Dasar tadbir urus contoh (simulasi)",
      validation: "Masukkan soalan antara 1 hingga 2,000 aksara.", authentication: "Sesi anda telah tamat atau berubah. Log keluar dan log masuk semula untuk meneruskan.",
      forbidden: "Pertanyaan pengetahuan memerlukan akaun pentadbir atau setiausaha dengan organisasi yang aktif.",
      timeout: "Permintaan tamat masa. Soalan anda dikekalkan; cuba semula.", network: "Perkhidmatan pengetahuan tidak dapat dihubungi. Semak sambungan anda dan cuba semula.",
      unavailable: "Perkhidmatan pengetahuan tidak tersedia. Cuba kemudian atau minta pentadbir menyemak konfigurasinya.",
      invalid_response: "Perkhidmatan mengembalikan jawapan tidak lengkap atau tidak sah. Cuba semula kemudian.", rate_limit: "Terlalu banyak permintaan. Tunggu sebentar, kemudian cuba semula.",
    },
  };

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function mount(container, { source }) {
    const t = COPY[document.documentElement.lang === "en" ? "EN" : "BM"];
    const demo = source === "demo";
    const api = window.AGMX_API;
    let active = true;
    let request = null;
    const view = node("section", "agmx-copilot");
    const heading = node("div", "agmx-page-heading");
    const title = node("div");
    title.append(node("h1", "", "AI Copilot"), node("p", "", t.intro));
    heading.append(title, node("span", `agmx-source-badge${demo ? " is-demo" : ""}`, demo ? t.demo : t.live));
    view.append(heading);
    container.append(view);

    function dispose() {
      active = false;
      if (request) request.abort();
      view.replaceChildren();
    }

    if (!demo && (!api || !api.canQueryKnowledge || !api.canQueryKnowledge())) {
      const notice = node("section", "agmx-card");
      notice.append(node("h2", "", t.access), node("p", "", t.accessNote));
      view.append(notice);
      return dispose;
    }
    if (demo) view.append(node("p", "agmx-demo-banner", t.demoNote));

    const form = node("form", "agmx-card agmx-copilot-form");
    const label = node("label", "", t.label);
    label.htmlFor = "copilot-question";
    const input = node("textarea", "agmx-copilot-input");
    input.id = "copilot-question";
    input.name = "query";
    input.rows = 3;
    input.maxLength = 2000;
    input.required = true;
    input.placeholder = t.placeholder;
    input.setAttribute("aria-describedby", "copilot-hint copilot-error");
    if (demo) { input.value = t.sampleQuestion; input.readOnly = true; }
    const hint = node("p", "agmx-copilot-hint", demo ? t.demo : t.hint);
    hint.id = "copilot-hint";
    const error = node("p", "agmx-copilot-error");
    error.id = "copilot-error";
    error.setAttribute("role", "alert");
    const controls = node("div", "agmx-copilot-controls");
    const submit = node("button", "agmx-shell-button agmx-copilot-submit", demo ? t.sample : t.ask);
    submit.type = "submit";
    const cancel = node("button", "agmx-shell-button", t.cancel);
    cancel.type = "button";
    cancel.hidden = true;
    const status = node("p", "agmx-copilot-status", t.ready);
    status.setAttribute("role", "status");
    status.setAttribute("aria-atomic", "true");
    controls.append(submit, cancel);
    form.append(label, input, hint, error, controls);
    const result = node("div", "agmx-copilot-result");
    result.setAttribute("aria-busy", "false");
    view.append(form, status, result);

    cancel.addEventListener("click", () => {
      if (request) request.abort();
    });
    input.addEventListener("input", () => {
      input.removeAttribute("aria-invalid");
      error.textContent = "";
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (request || !active) return;
      const question = input.value.trim();
      if (!question || question.length > 2000) {
        error.textContent = t.validation;
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      const controller = new AbortController();
      request = controller;
      input.readOnly = true;
      input.removeAttribute("aria-invalid");
      submit.disabled = true;
      cancel.hidden = demo;
      error.textContent = "";
      status.textContent = t.loading;
      result.replaceChildren();
      result.setAttribute("aria-busy", "true");
      try {
        const answer = demo ? sample(t) : await api.queryKnowledge(question, { signal: controller.signal });
        if (!active || controller.signal.aborted) return;
        renderAnswer(result, answer, question, t, demo);
        status.textContent = answer.claims.length ? t.complete : t.empty;
        submit.textContent = demo ? t.sample : t.ask;
      } catch (failure) {
        if (!active) return;
        if (controller.signal.aborted) status.textContent = t.cancelled;
        else {
          error.textContent = t[failure && failure.knowledgeCode] || t.unavailable;
          status.textContent = "";
          submit.textContent = t.retry;
        }
      } finally {
        if (active) {
          if (controller.signal.aborted) status.textContent = t.cancelled;
          input.readOnly = demo;
          submit.disabled = false;
          cancel.hidden = true;
          result.setAttribute("aria-busy", "false");
          // Restore focus only when the disabled submit/cancel control had it.
          if (document.activeElement === cancel || document.activeElement === submit) submit.focus();
        }
        request = null;
      }
    });
    return dispose;
  }

  function renderAnswer(container, result, question, t, demo) {
    const card = node("section", "agmx-card agmx-copilot-answer");
    card.append(node("h2", "", result.claims.length ? t.answer : t.empty));
    if (demo) card.append(node("p", "agmx-demo-banner", t.demo));
    card.append(node("p", "agmx-copilot-question", `${t.question}: ${question}`));
    if (!result.claims.length) card.append(node("p", "", t.emptyNote));

    const sources = node("section", "agmx-card agmx-copilot-sources");
    sources.append(node("h2", "", t.sources));
    const references = new Map();
    // Include only sources supporting displayed claims. IDs remain plain text;
    // citation buttons reveal local details without changing the SPA hash.
    for (const claim of result.claims) {
      for (const id of claim.citations) {
        if (references.has(id)) continue;
        const chunk = result.evidence.chunks.find(item => item.id === id);
        const number = references.size + 1;
        const details = node("details", "agmx-copilot-source");
        const page = chunk.page === null ? t.noPage : `${t.page} ${chunk.page}`;
        const caption = `[${number}] ${chunk.title || t.untitled} · ${page}`;
        const summary = node("summary", "", caption);
        details.append(summary, node("p", "agmx-copilot-hint", t.excerpt), node("blockquote", "", chunk.text));
        const quotes = [...new Set(result.evidence.assertions.filter(edge => edge.chunkId === id).map(edge => edge.quote))];
        quotes.forEach(quote => details.append(node("p", "agmx-copilot-hint", t.quote), node("blockquote", "", quote)));
        details.append(node("p", "agmx-copilot-source-id", `Document: ${chunk.documentId || "—"} · Chunk: ${id}`));
        sources.append(details);
        references.set(id, { number, details, summary, caption });
      }
      const item = node("article", "agmx-copilot-claim");
      item.append(node("strong", "agmx-copilot-kind", claim.kind === "inference" ? t.inference : t.fact), node("p", "", claim.text));
      const citations = node("div", "agmx-copilot-citations");
      [...new Set(claim.citations)].forEach(id => {
        const ref = references.get(id);
        const button = node("button", "agmx-shell-button", `${t.source} [${ref.number}]`);
        button.type = "button";
        button.setAttribute("aria-label", `${t.source} ${ref.caption}`);
        button.addEventListener("click", () => {
          ref.details.open = true;
          ref.summary.focus({ preventScroll: true });
          ref.details.scrollIntoView({ block: "nearest", behavior: "auto" });
        });
        citations.append(button);
      });
      item.append(citations);
      card.append(item);
    }
    if (result.unknowns.length) {
      const list = node("ul");
      result.unknowns.forEach(text => list.append(node("li", "", text)));
      card.append(node("h3", "", t.unknowns), list);
    }
    container.append(card);
    if (references.size) container.append(sources);
  }

  function sample(t) {
    return {
      claims: [{ text: t.sampleClaim, kind: "fact", citations: ["demo-policy:0"] }], unknowns: [],
      evidence: { chunks: [{ id: "demo-policy:0", documentId: "demo-policy", title: t.sampleTitle, page: 1, text: t.sampleText }], assertions: [] },
    };
  }

  window.AGMX_COPILOT = { mount };
})(window, document);
