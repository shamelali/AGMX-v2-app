(() => {
  "use strict";
  const { text, download } = window.AGMX_TOOLS;
  const $ = (id) => document.getElementById(id);
  let documents = [],
    generation = 0,
    isSample = false;
  function sampleDocs() {
    return [
      {
        name: text("Minit contoh.txt", "Sample minutes.txt"),
        lines: [
          text("Draf minit contoh", "Sample draft minutes"),
          text(
            "Kehadiran direkod sebelum kuorum diumumkan.",
            "Attendance was recorded before quorum was declared.",
          ),
          text(
            "Setiausaha membentangkan laporan tahunan kepada ahli.",
            "The secretary presented the annual report to the members.",
          ),
          text(
            "Tindakan: edar minit kepada ahli untuk semakan.",
            "Action: circulate the minutes to members for review.",
          ),
        ],
      },
    ];
  }
  function resetResults() {
    $("passages").replaceChildren();
  }
  async function loadFiles() {
    const ticket = ++generation,
      files = Array.from($("docs").files);
    documents = [];
    isSample = false;
    resetResults();
    if (!files.length) {
      $("doc-status").textContent = "";
      return;
    }
    if (
      files.length > 8 ||
      files.reduce((a, b) => a + b.size, 0) > 2 * 1024 * 1024 ||
      files.some((f) => !/[.](md|txt)$/i.test(f.name))
    ) {
      $("doc-status").textContent = text(
        "Pilih fail .txt atau .md dalam had yang tertera.",
        "Choose .txt or .md files within the stated limits.",
      );
      return;
    }
    try {
      const loaded = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          lines: (await f.text()).split(/\r\n?|\n/),
        })),
      );
      if (ticket !== generation) return;
      documents = loaded;
      $("doc-status").textContent =
        text("Fail dimuatkan: ", "Files loaded: ") +
        loaded.map((d) => d.name).join(", ");
    } catch (_) {
      if (ticket === generation)
        $("doc-status").textContent = text(
          "Fail gagal dibaca.",
          "Could not read the files.",
        );
    }
  }
  function search() {
    resetResults();
    if (!documents.length) {
      $("doc-status").textContent = text(
        "Pilih dokumen atau buka contoh dahulu.",
        "Choose documents or try the sample first.",
      );
      return;
    }
    const terms = [
      ...new Set(
        $("search")
          .value.normalize("NFKC")
          .trim()
          .toLocaleLowerCase()
          .split(/\s+/)
          .filter(Boolean),
      ),
    ];
    if (!terms.length) return;
    const matches = [];
    documents.forEach((doc) =>
      doc.lines.forEach((line, index) => {
        const normalized = line.normalize("NFKC").toLocaleLowerCase();
        if (terms.every((term) => normalized.includes(term)))
          matches.push({ name: doc.name, index, line });
      }),
    );
    $("doc-status").textContent = matches.length
      ? text("Petikan ditemui: ", "Passages found: ") +
        matches.length +
        (matches.length > 30
          ? text(" · 30 pertama dipaparkan", " · showing the first 30")
          : "")
      : text("Tiada petikan sepadan.", "No matching passage.");
    for (const hit of matches.slice(0, 30)) {
      const li = document.createElement("li"),
        source = document.createElement("strong"),
        passage = document.createElement("p");
      source.textContent =
        hit.name + text(" · baris ", " · line ") + (hit.index + 1);
      passage.textContent = hit.line;
      li.append(source, passage);
      $("passages").appendChild(li);
    }
  }
  $("docs").addEventListener("change", loadFiles);
  $("sample-docs").onclick = () => {
    generation++;
    isSample = true;
    documents = sampleDocs();
    $("docs").value = "";
    $("search").value = text("kuorum", "quorum");
    search();
  };
  $("search-form").onsubmit = (e) => {
    e.preventDefault();
    search();
  };
  $("template-form").onsubmit = (e) => {
    e.preventDefault();
    const type = $("document-type").value,
      date = $("meeting-date").value;
    const headings = {
      notice: [
        text("Tarikh edaran", "Date issued"),
        text("Penerima", "Recipients"),
        text("Perkara untuk pertimbangan", "Business to consider"),
        text("Cara mengesahkan kehadiran", "How to confirm attendance"),
        text("Dikeluarkan oleh", "Issued by"),
      ],
      agenda: [
        text("Pengesahan kehadiran dan kuorum", "Attendance and quorum"),
        text("Pengesahan minit terdahulu", "Approval of previous minutes"),
        text("Laporan dan usul", "Reports and motions"),
        text("Tindakan susulan", "Follow-up actions"),
      ],
      minutes: [
        text("Pengerusi dan setiausaha", "Chair and secretary"),
        text("Kehadiran dan kuorum", "Attendance and quorum"),
        text("Keputusan setiap usul", "Decisions on each motion"),
        text(
          "Tindakan, pemilik dan tarikh siap",
          "Actions, owners and due dates",
        ),
        text("Semakan dan kelulusan", "Review and approval"),
      ],
    };
    const title = $("document-type").selectedOptions[0].textContent;
    const lines = [
      text("DRAF", "DRAFT") + " · " + title,
      $("meeting-name").value.trim(),
      date + " · " + $("meeting-venue").value.trim(),
      "",
      ...headings[type].map((h) => h + "\n________________________________\n"),
    ];
    download(
      new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }),
      "agm-" + type + "-" + date + ".txt",
    );
    $("template-status").textContent = text(
      "Draf dimuat turun.",
      "Draft downloaded.",
    );
  };
  window.addEventListener("agmx-language", () => {
    if (isSample) {
      documents = sampleDocs();
      $("search").value = text("kuorum", "quorum");
      search();
    } else if ($("passages").children.length) search();
  });
})();
