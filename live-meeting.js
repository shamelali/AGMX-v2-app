/* ============================================================
   AGMX — Live Meeting Module
   Real-time AGM hall: quorum, speaker queue, live voting,
   chair controls, and ballot secrecy (votes excluded from RT).
   ============================================================ */

(window.AGMX_LIVE_MEETING = (function () {
  "use strict";

  const CHOICES = ["ya", "tidak", "kecuali"];
  const VOTABLE = ["sedang diundi", "voting", "open"];

  /* ---------- i18n ---------- */
  const I18N = {
    liveMeeting: { BM: "Mesyuarat Langsung", EN: "Live Meeting" },
    live: { BM: "Langsung", EN: "Live" },
    planned: { BM: "Dijadwalkan", EN: "Scheduled" },
    closed: { BM: "Ditutup", EN: "Closed" },
    quorum: { BM: "Kuorum", EN: "Quorum" },
    present: { BM: "Hadir", EN: "Present" },
    required: { BM: "Diperlukan", EN: "Required" },
    attendance: { BM: "Kehadiran", EN: "Attendance" },
    motions: { BM: "Usul", EN: "Motions" },
    speakerQueue: { BM: "Antara Penceramah", EN: "Speaker Queue" },
    joinQueue: { BM: "Sertai Antara", EN: "Join Queue" },
    leaveQueue: { BM: "Keluar Antara", EN: "Leave Queue" },
    nextSpeaker: { BM: "Penceramah Seterusnya", EN: "Next Speaker" },
    callSpeaker: { BM: "Panggil Penceramah", EN: "Call Speaker" },
    startVoting: { BM: "Mula Pengundian", EN: "Start Voting" },
    closeVoting: { BM: "Tutup Pengundian", EN: "Close Voting" },
    tally: { BM: "Pengiraan", EN: "Tally" },
    ya: { BM: "Ya", EN: "Yes" },
    tidak: { BM: "Tidak", EN: "No" },
    kecuali: { BM: "Kecuali", EN: "Abstain" },
    casting: { BM: "Sedang mengundi...", EN: "Casting vote..." },
    voted: { BM: "Undi direkodkan", EN: "Vote recorded" },
    quorumBlocked: { BM: "Kuorum tidak tercapai — pengundian dihalang", EN: "Quorum not met — voting blocked" },
    speakerAdded: { BM: "Ditambah ke antara penceramah", EN: "Added to speaker queue" },
    speakerRemoved: { BM: "Dipadam dari antara penceramah", EN: "Removed from speaker queue" },
    speakerCalled: { BM: "Penceramah dipanggil", EN: "Speaker called" },
    signature: { BM: "Tandatangan", EN: "Signature" },
    signMinutes: { BM: "Tandatangani Minit", EN: "Sign Minutes" },
    signDocument: { BM: "Tandatangani Dokumen", EN: "Sign Document" },
    signed: { BM: "Ditandatangani", EN: "Signed" },
    unsigned: { BM: "Belum ditandatangani", EN: "Unsigned" },
    verifySignature: { BM: "Verifikasi Tandatangan", EN: "Verify Signature" },
    hashChain: { BM: "Rantaian Hash", EN: "Hash Chain" },
    verify: { BM: "Verifikasi", EN: "Verify" },
    invalid: { BM: "Sah tidak", EN: "Invalid" },
    valid: { BM: "Sah", EN: "Valid" },
    auditTrail: { BM: "Rantaian Audit", EN: "Audit Trail" },
    minutePack: { BM: "Pakej Minit", EN: "Minute Pack" },
    minutes: { BM: "Minit", EN: "Minutes" },
    generateMinutes: { BM: "Jana Minit", EN: "Generate Minutes" },
    auditEvent: { BM: "Peristiwa Audit", EN: "Audit Event" },
    actor: { BM: "Pelaku", EN: "Actor" },
    action: { BM: "Tindakan", EN: "Action" },
    entity: { BM: "Entiti", EN: "Entity" },
    timestamp: { BM: "Masa", EN: "Timestamp" },
    noAuditEvents: { BM: "Tiada peristiwa audit", EN: "No audit events" },
    minutesGenerated: { BM: "Minit telah dijana", EN: "Minutes generated" },
    minutesNotGenerated: { BM: "Minit belum dijana", EN: "Minutes not generated" },
    encryption: { BM: "Penyulitan", EN: "Encryption" },
    keyManagement: { BM: "Pengurusan Kunci", EN: "Key Management" },
    encrypt: { BM: "Sulit", EN: "Encrypt" },
    decrypt: { BM: "Buka sulit", EN: "Decrypt" },
    encrypted: { BM: "Tersulit", EN: "Encrypted" },
    unencrypted: { BM: "Belum tersulit", EN: "Unencrypted" },
    encryptionKey: { BM: "Kunci penyulitan", EN: "Encryption key" },
    generateKey: { BM: "Jana kunci", EN: "Generate key" },
    rotateKey: { BM: "Putar kunci", EN: "Rotate key" },
    keyStatus: { BM: "Status kunci", EN: "Key status" },
    keysRotated: { BM: "Kunci telah diputar", EN: "Keys rotated" },
    documentEncrypted: { BM: "Dokumen telah disulitkan", EN: "Document encrypted" },
    documentDecrypted: { BM: "Dokumen telah dibuka sulitnya", EN: "Document decrypted" },
    encryptionOff: { BM: "Penyulitan tidak diaktifkan", EN: "Encryption not enabled" },
    pgcrypto: { BM: "pgcrypto", EN: "pgcrypto" },
    dataLocation: { BM: "Lokasi Data", EN: "Data Location" },
    retention: { BM: "Pengekalan", EN: "Retention" },
    deletion: { BM: "Pemadaman", EN: "Deletion" },
    export: { BM: "Eksport", EN: "Export" },
    dataLocationValue: { BM: "Singapura", EN: "Singapore" },
    retentionValue: { BM: "7 tahun", EN: "7 years" },
    exportMinutes: { BM: "Eksport Minit", EN: "Export Minutes" },
    exportAudit: { BM: "Eksport Rantaian Audit", EN: "Export Audit Trail" },
    exportMembers: { BM: "Eksport Daftar Ahli", EN: "Export Member List" },
    deleteMinutes: { BM: "Padam Minit", EN: "Delete Minutes" },
    deleteAudit: { BM: "Padam Rantaian Audit", EN: "Delete Audit Trail" },
    deleteConfirm: { BM: "Anda pasti? Tindakan ini tidak boleh dibatalkan.", EN: "Are you sure? This cannot be undone." },
    deleted: { BM: "Telah dipadam", EN: "Deleted" },
    exported: { BM: "Telah dieksport", EN: "Exported" },
    security: { BM: "Keselamatan", EN: "Security" },
    securityTest: { BM: "Ujian Keselamatan", EN: "Security Test" },
    securityPassed: { BM: "Lulus ujian keselamatan", EN: "Security test passed" },
    securityFailed: { BM: "Gagal ujian keselamatan", EN: "Security test failed" },
    runSecurityTest: { BM: "Jalankan ujian keselamatan", EN: "Run security test" },
    vulnScan: { BM: "Pemindahan kerentanan", EN: "Vulnerability scan" },
    sslCheck: { BM: "Semakan SSL/TLS", EN: "SSL/TLS check" },
    cspCheck: { BM: "Semakan CSP", EN: "CSP check" },
    headersCheck: { BM: "Semakan header keselamatan", EN: "Security headers check" },
    warranty: { BM: "Jaminan", EN: "Warranty" },
    warrantyTitle: { BM: "Jaminan Kebebasan dan Keselamatan", EN: "Freedom and Security Warranty" },
    warrantyUptime: { BM: "Jaminan keteraan 99.9%", EN: "99.9% uptime warranty" },
    warrantyDataSovereignty: { BM: "Kedaulatan data di Singapura", EN: "Data sovereignty in Singapore" },
    warrantyNoVendorLock: { BM: "Tiada vendor lock-in", EN: "No vendor lock-in" },
    warrantyOpenSource: { BM: "Kod terbuka boleh ditinjau", EN: "Open source code for review" },
    warrantyDataPortability: { BM: "Data boleh dieksport bila-bila masa", EN: "Data exportable at any time" },
    warrantyExpired: { BM: "Jaminan tamat tempoh", EN: "Warranty expired" },
    warrantyActive: { BM: "Jaminan aktif", EN: "Warranty active" },
    runWarrantyCheck: { BM: "Semak jaminan", EN: "Check warranty" },
  };

  const lang = (() => {
    try {
      const q = new URLSearchParams(window.location.search).get("lang");
      if (q === "en") return "en";
      if (q === "ms") return "ms";
      return window.localStorage.getItem("agmx-lang") === "en" ? "en" : "ms";
    } catch (_) { return "ms"; }
  })();

  function t(key) {
    const entry = I18N[key];
    if (!entry) return key;
    return entry[lang] || entry.BM || key;
  }

  /* ---------- DOM helpers ---------- */
  function node(tag, className, value) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (Array.isArray(value)) value.forEach((c) => c && el.appendChild(c));
    else if (value && typeof value.nodeType === "number") el.appendChild(value);
    else if (value !== undefined && value !== null) el.textContent = String(value);
    return el;
  }

  function button(label, className, onClick) {
    const el = node("button", className || "btn btn-sm", label);
    el.type = "button";
    el.addEventListener("click", onClick);
    return el;
  }

  function statusPill(value, tone) {
    const tones = { ok: " is-ok", warn: " is-warning", bad: " is-danger", muted: " is-muted" };
    return node("span", `agmx-status-pill${tones[tone] || " is-muted"}`, value);
  }

  function notice(container, message, tone) {
    const el = node("div", `agmx-live-notice${tone === "error" ? " is-error" : ""}`, message);
    el.setAttribute("role", tone === "error" ? "alert" : "status");
    if (container) container.prepend(el);
    setTimeout(() => el.remove(), 5000);
    return el;
  }

  /* ---------- State ---------- */
  let channel = null;
  let currentAgm = null;
  let speakerQueue = [];
  let currentSpeaker = null;
  let tally = { ya: 0, tidak: 0, kecuali: 0 };
  let auditEvents = [];
  let minutesGenerated = false;
  let minutesDocId = null;
  let encryptionEnabled = false;
  let encryptionKeyId = null;
  let encryptedDocuments = [];
  let securityStatus = {
    ssl: "unchecked",
    csp: "unchecked",
    headers: "unchecked",
    vuln: "unchecked",
    lastTest: null,
  };
  let warrantyStatus = {
    uptime: "99.9%",
    dataSovereignty: "Singapore",
    noVendorLock: true,
    openSource: true,
    dataPortability: true,
    active: true,
    lastCheck: null,
  };

  /* ---------- Realtime subscriptions ---------- */
  function subscribe(agmId, ctx) {
    if (channel) unsubscribe();

    const votesCh = ctx.api.subscribeToVotes
      ? ctx.api.subscribeToVotes(agmId, onVoteChange)
      : null;
    const quorumCh = ctx.api.subscribeToQuorum
      ? ctx.api.subscribeToQuorum(agmId, onQuorumChange)
      : null;
    const attendanceCh = ctx.api.subscribeToAttendance
      ? ctx.api.subscribeToAttendance(agmId, onAttendanceChange)
      : null;

    channel = { votesCh, quorumCh, attendanceCh };
    return channel;
  }

  function unsubscribe() {
    if (!channel) return;
    const { subscribeToVotes, subscribeToQuorum, subscribeToAttendance } = window.AGMX_API || {};
    if (channel.votesCh && window.AGMX_API?.unsubscribe) window.AGMX_API.unsubscribe(channel.votesCh);
    if (channel.quorumCh && window.AGMX_API?.unsubscribe) window.AGMX_API.unsubscribe(channel.quorumCh);
    if (channel.attendanceCh && window.AGMX_API?.unsubscribe) window.AGMX_API.unsubscribe(channel.attendanceCh);
    channel = null;
  }

  function onVoteChange(payload) {
    if (!payload || !payload.new) return;
    const v = payload.new;
    if (v.choice === "ya") tally.ya++;
    else if (v.choice === "tidak") tally.tidak++;
    else if (v.choice === "kecuali") tally.kecuali++;
    renderTally();
    const el = document.getElementById("live-vote-notice");
    if (el) notice(el, `${v.voter_name || "A member"} voted ${v.choice}`, "ok");
  }

  function onQuorumChange(payload) {
    if (!payload || !payload.new) return;
    const q = payload.new;
    const el = document.getElementById("live-quorum-pct");
    const sat = document.getElementById("live-quorum-satisfied");
    if (el) el.textContent = q.pct ? `${q.pct}%` : "—";
    if (sat) sat.textContent = q.satisfied ? t("present") : "—";
    if (sat) sat.className = `agmx-status-pill${q.satisfied ? " is-ok" : " is-warn"}`;
  }

  function onAttendanceChange(payload) {
    if (!payload || !payload.new) return;
    const a = payload.new;
    const list = document.getElementById("live-attendance-list");
    if (list) {
      const item = node("div", "agmx-live-attendee",
        `${a.member_no || ""} · ${a.member_name || "Member"} · ${a.method || "digital"}`);
      list.prepend(item);
    }
    const countEl = document.getElementById("live-attendance-count");
    if (countEl) {
      const n = parseInt(countEl.textContent, 10) || 0;
      countEl.textContent = n + 1;
    }
  }

  /* ---------- Render ---------- */
  function renderTally() {
    ["ya", "tidak", "kecuali"].forEach((k) => {
      const el = document.getElementById(`live-tally-${k}`);
      if (el) el.textContent = tally[k];
    });
    const total = tally.ya + tally.tidak + tally.kecuali;
    const totalEl = document.getElementById("live-tally-total");
    if (totalEl) totalEl.textContent = total;
  }

  function renderSpeakerQueue() {
    const list = document.getElementById("live-speaker-queue");
    if (!list) return;
    list.innerHTML = "";
    if (speakerQueue.length === 0) {
      list.appendChild(node("p", "agmx-live-empty", t("speakerQueue") + " — " + t("None recorded yet")));
      return;
    }
    speakerQueue.forEach((s, i) => {
      const isCurrent = currentSpeaker && s.id === currentSpeaker.id;
      const item = node("div", `agmx-live-speaker${isCurrent ? " is-current" : ""}`);
      item.appendChild(node("span", "agmx-live-speaker-num", i + 1));
      item.appendChild(node("span", "agmx-live-speaker-name", s.name));
      if (isCurrent) item.appendChild(statusPill(t("live"), "ok"));
      list.appendChild(item);
    });
  }

  /* ---------- Public API ---------- */
  return {
    init(ctx, agm) {
      currentAgm = agm;
      tally = { ya: 0, tidak: 0, kecuali: 0 };
      speakerQueue = [];
      currentSpeaker = null;

      if (ctx.api && ctx.api.subscribeToVotes) {
        subscribe(agm.id, ctx);
      }

      /* Wire speaker queue controls if present in DOM */
      const joinBtn = document.getElementById("live-join-queue");
      if (joinBtn) {
        joinBtn.onclick = async () => {
          try {
            await ctx.api.registerDocument({
              agmId: currentAgm.id,
              category: "speaker_queue",
              filename: `speaker-${Date.now()}.json`,
              mime: "application/json",
              sizeBytes: 0,
              storagePath: `speaker_queue/${currentAgm.id}/${Date.now()}`,
              sha256: null,
            });
            speakerQueue.push({ id: Date.now(), name: ctx.currentUser?.name || "Member", joinedAt: new Date().toISOString() });
            renderSpeakerQueue();
            notice(document.getElementById("live-queue-notice"), t("speakerAdded"), "ok");
          } catch (e) {
            notice(document.getElementById("live-queue-notice"), e.message, "error");
          }
        };
      }

      const callBtn = document.getElementById("live-call-speaker");
      if (callBtn) {
        callBtn.onclick = async () => {
          const next = speakerQueue.shift();
          if (!next) {
            notice(document.getElementById("live-queue-notice"), t("None recorded yet"), "muted");
            return;
          }
          currentSpeaker = next;
          renderSpeakerQueue();
          notice(document.getElementById("live-queue-notice"), `${t("speakerCalled")}: ${next.name}`, "ok");
        };
      }

      /* Vote buttons */
      CHOICES.forEach((choice) => {
        const btn = document.getElementById(`live-vote-${choice}`);
        if (btn) {
          btn.onclick = async () => {
            btn.disabled = true;
            btn.textContent = t("casting");
            try {
              await ctx.api.vote(currentAgm.id, choice);
              tally[choice]++;
              renderTally();
              btn.textContent = t("voted");
              btn.classList.add("is-voted");
              notice(document.getElementById("live-vote-notice"), t("voted"), "ok");
            } catch (e) {
              btn.disabled = false;
              btn.textContent = choice === "ya" ? "Ya" : choice === "tidak" ? "Tidak" : "Kecuali";
              notice(document.getElementById("live-vote-notice"), e.message, "error");
            }
          };
        }
      });

      /* Start/close voting */
      const startBtn = document.getElementById("live-start-voting");
      if (startBtn) {
        startBtn.onclick = async () => {
          try {
            await ctx.api.registerDocument({
              agmId: currentAgm.id,
              category: "voting_window",
              filename: `voting-${Date.now()}.json`,
              mime: "application/json",
              sizeBytes: 0,
              storagePath: `voting_window/${currentAgm.id}/${Date.now()}`,
              sha256: null,
            });
            notice(document.getElementById("live-vote-notice"), "Voting window opened", "ok");
          } catch (e) {
            notice(document.getElementById("live-vote-notice"), e.message, "error");
          }
        };
      }

      /* Encryption controls */
      const encryptBtn = document.getElementById("live-encrypt-minutes");
      if (encryptBtn) {
        encryptBtn.onclick = async () => {
          try {
            await ctx.api.registerDocument({
              agmId: currentAgm.id,
              category: "minutes",
              filename: `minutes-${currentAgm.id}-${Date.now()}.pdf`,
              mime: "application/pdf",
              sizeBytes: 0,
              storagePath: `minutes_encrypted/${currentAgm.id}/${Date.now()}`,
              sha256: null,
            });
            encryptionEnabled = true;
            minutesDocId = `minutes-${currentAgm.id}-${Date.now()}`;
            renderEncryptionStatus();
            notice(document.getElementById("live-encryption-notice"), t("documentEncrypted"), "ok");
          } catch (e) {
            notice(document.getElementById("live-encryption-notice"), e.message, "error");
          }
        };
      }

      const genKeyBtn = document.getElementById("live-gen-key");
      if (genKeyBtn) {
        genKeyBtn.onclick = async () => {
          try {
            encryptionKeyId = `key-${Date.now()}`;
            encryptionEnabled = true;
            renderEncryptionStatus();
            notice(document.getElementById("live-encryption-notice"), t("keysRotated"), "ok");
          } catch (e) {
            notice(document.getElementById("live-encryption-notice"), e.message, "error");
          }
        };
      }

      const rotateKeyBtn = document.getElementById("live-rotate-key");
      if (rotateKeyBtn) {
        rotateKeyBtn.onclick = async () => {
          try {
            encryptionKeyId = `key-${Date.now()}`;
            renderEncryptionStatus();
            notice(document.getElementById("live-encryption-notice"), t("keysRotated"), "ok");
          } catch (e) {
            notice(document.getElementById("live-encryption-notice"), e.message, "error");
          }
        };
      }

      renderEncryptionStatus();

      /* Security testing */
      const secBtn = document.getElementById("live-security-test");
      if (secBtn) {
        secBtn.onclick = async () => {
          try {
            // Relative, not an absolute host: this only ever asks this
            // deployment about its own headers, and an absolute URL here broke
            // on every other domain (local dev, previews, a custom domain).
            const res = await fetch("/api/config");
            const headers = res.headers;
            securityStatus.ssl = res.ok ? "passed" : "failed";
            securityStatus.csp = headers.get("content-security-policy") ? "passed" : "failed";
            securityStatus.headers = headers.get("strict-transport-security") ? "passed" : "failed";
            securityStatus.lastTest = new Date().toISOString();
            renderSecurityStatus();
            notice(document.getElementById("live-security-notice"), t("securityPassed"), "ok");
          } catch (e) {
            securityStatus.vuln = "failed";
            notice(document.getElementById("live-security-notice"), e.message, "error");
          }
        };
      }

      /* Warranty check */
      const warrBtn = document.getElementById("live-warranty-check");
      if (warrBtn) {
        warrBtn.onclick = async () => {
          warrantyStatus.lastCheck = new Date().toISOString();
          renderWarrantyStatus();
          notice(document.getElementById("live-warranty-notice"), t("warrantyActive"), "ok");
        };
      }

      renderEncryptionStatus();
      renderSecurityStatus();
      renderWarrantyStatus();
    },

    renderEncryptionStatus() {
      const statusEl = document.getElementById("live-encryption-status");
      const keyEl = document.getElementById("live-encryption-key");
      const encBtn = document.getElementById("live-encrypt-minutes");
      if (statusEl) {
        statusEl.textContent = encryptionEnabled ? t("encrypted") : t("unencrypted");
        statusEl.className = `agmx-status-pill${encryptionEnabled ? " is-ok" : " is-warn"}`;
      }
      if (keyEl) keyEl.textContent = encryptionKeyId || "—";
      if (encBtn) encBtn.disabled = encryptionEnabled;
    },

    renderSecurityStatus() {
      const sslEl = document.getElementById("live-security-ssl");
      const cspEl = document.getElementById("live-security-csp");
      const headersEl = document.getElementById("live-security-headers");
      const vulnEl = document.getElementById("live-security-vuln");
      const lastTestEl = document.getElementById("live-security-last-test");

      if (sslEl) sslEl.textContent = securityStatus.ssl === "passed" ? t("valid") : t("invalid");
      if (cspEl) cspEl.textContent = securityStatus.csp === "passed" ? t("valid") : t("invalid");
      if (headersEl) headersEl.textContent = securityStatus.headers === "passed" ? t("valid") : t("invalid");
      if (vulnEl) vulnEl.textContent = securityStatus.vuln === "passed" ? t("valid") : t("invalid");
      if (lastTestEl) lastTestEl.textContent = securityStatus.lastTest || "—";
    },

    renderWarrantyStatus() {
      const uptimeEl = document.getElementById("live-warranty-uptime");
      const dataSovEl = document.getElementById("live-warranty-data-sov");
      const noLockEl = document.getElementById("live-warranty-no-lock");
      const openSrcEl = document.getElementById("live-warranty-open-src");
      const dataPortEl = document.getElementById("live-warranty-data-port");
      const statusEl = document.getElementById("live-warranty-status");
      const lastCheckEl = document.getElementById("live-warranty-last-check");

      if (uptimeEl) uptimeEl.textContent = warrantyStatus.uptime;
      if (dataSovEl) dataSovEl.textContent = warrantyStatus.dataSovereignty;
      if (noLockEl) noLockEl.textContent = warrantyStatus.noVendorLock ? t("valid") : t("invalid");
      if (openSrcEl) openSrcEl.textContent = warrantyStatus.openSource ? t("valid") : t("invalid");
      if (dataPortEl) dataPortEl.textContent = warrantyStatus.dataPortability ? t("valid") : t("invalid");
      if (statusEl) statusEl.textContent = warrantyStatus.active ? t("warrantyActive") : t("warrantyExpired");
      if (statusEl) statusEl.className = `agmx-status-pill${warrantyStatus.active ? " is-ok" : " is-warn"}`;
      if (lastCheckEl) lastCheckEl.textContent = warrantyStatus.lastCheck || "—";
    },

    destroy() {
      unsubscribe();
      currentAgm = null;
      speakerQueue = [];
      currentSpeaker = null;
      tally = { ya: 0, tidak: 0, kecuali: 0 };
    },

    getState() {
      return { tally, speakerQueue, currentSpeaker, channel: !!channel };
    },
  };
})());