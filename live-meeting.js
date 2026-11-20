/* The rehearsal stays in memory. The member room reads from the signed-in tenant. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const { text } = window.AGMX_TOOLS;
  const params = new URLSearchParams(location.search);
  const demo = params.get("demo") === "1";
  let room,
    client,
    agmId,
    busy = false,
    pendingRead = false,
    sequence = 0;
  let entryMessage, feedback;
  const message = (ms, en) => [ms, en];
  function broadcastId(url) {
    let id;
    if (url.hostname === "youtu.be") id = url.pathname.slice(1);
    if (["www.youtube.com", "youtube.com"].includes(url.hostname)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else if (url.pathname.startsWith("/live/")) id = url.pathname.slice(6);
    }
    return /^[a-zA-Z0-9_-]{11}$/.test(id || "") ? id : "";
  }
  let streamId = "";
  function safeVideo(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== "https:" || u.username || u.password || u.port)
        return "";
      const id = broadcastId(u);
      if (id) return "https://www.youtube.com/watch?v=" + id;
      return /^(meet\.google\.com|([a-z0-9-]+\.)?zoom\.us|teams\.microsoft\.com|teams\.live\.com)$/i.test(
        u.hostname,
      )
        ? u.href
        : "";
    } catch (_) {
      return "";
    }
  }
  function paint() {
    $("source").textContent = demo
      ? text("Raptai · data contoh", "Rehearsal · sample data")
      : text("Ruang kerja ahli", "Member workspace");
    $("entry").hidden = !!room;
    $("room").hidden = !room;
    const video = safeVideo(room?.link);
    const nextStream = video ? broadcastId(new URL(video)) : "";
    if (nextStream !== streamId) {
      streamId = nextStream;
      $("stream-player").replaceChildren();
    }
    $("play-stream").hidden =
      !streamId || $("stream-player").childElementCount > 0;
    if (!room) {
      $("meeting-title").textContent = "";
      $("entry-message").textContent = text(
        ...(entryMessage || message("Membuka bilik…", "Opening the room…")),
      );
      return;
    }
    $("meeting-title").textContent = room.title;
    const live = room.status === "live";
    const active = room.speakers.find((s) => s.state === "called");
    const waiting = room.speakers.filter((s) => s.state === "waiting");
    const mine = room.speakers.find((s) => s.mine);
    $("current-speaker").textContent =
      active?.name || text("Giliran terbuka", "Floor open");
    $("caption").textContent =
      room.caption || text("Menunggu sari kata.", "Waiting for a caption.");
    $("video").hidden = !video;
    $("video").textContent = nextStream
      ? text("Buka siaran di YouTube", "Open broadcast on YouTube")
      : text("Sertai mesyuarat video", "Join the video meeting");
    if (video) $("video").href = video;
    else $("video").removeAttribute("href");
    $("speakers").replaceChildren(
      ...waiting.map((s) => {
        const li = document.createElement("li");
        li.textContent = s.name;
        return li;
      }),
    );
    $("empty-queue").hidden = waiting.length > 0;
    $("attend-note").hidden = room.checkedIn || !live;
    $("join").hidden = !!mine;
    $("join").disabled = busy || !room.checkedIn || !live;
    $("withdraw").hidden = mine?.state !== "waiting";
    $("withdraw").disabled = busy || !live;
    $("chair").hidden = !room.operator;
    $("call").disabled = busy || !live || !!active || !waiting.length;
    $("finish").disabled = busy || !live || !active;
    $("caption-form").querySelector("button").disabled = busy || !live;
    $("link-form").querySelector("button").disabled =
      busy || !["planned", "live"].includes(room.status);
    $("room-status").textContent = feedback ? text(...feedback) : "";
    if (demo) $("ballot-link").href = "/demo/guided-demo.html";
  }
  function unavailable(ms, en) {
    room = null;
    entryMessage = message(ms, en);
    paint();
  }
  async function refresh() {
    if (demo || busy || pendingRead || !client || !agmId) return;
    const ticket = sequence;
    pendingRead = true;
    try {
      const { data, error } = await client.rpc("agm_floor_state", {
        p_agm: agmId,
      });
      if (ticket !== sequence) return;
      if (error) throw error;
      if (!room || JSON.stringify(room) !== JSON.stringify(data)) {
        room = data;
        paint();
      }
    } catch (_) {
      if (ticket === sequence)
        unavailable(
          "Bilik tidak dapat dibaca. Semak sesi atau cuba semula.",
          "Could not read the room. Check your session or retry.",
        );
    } finally {
      pendingRead = false;
    }
  }
  function rehearse(action, value, id) {
    if (action === "join")
      room.speakers.push({
        id: "self",
        mine: true,
        state: "waiting",
        name: text("Anda (contoh)", "You (sample)"),
      });
    if (action === "withdraw" || action === "finish")
      room.speakers = room.speakers.filter((s) => s.id !== id);
    if (action === "call")
      room.speakers.find((s) => s.id === id).state = "called";
    if (action === "caption") room.caption = value.trim();
    if (action === "link") room.link = value;
  }
  async function change(action, value = null, id = null) {
    if (busy || !room) return;
    busy = true;
    sequence++;
    feedback = null;
    paint();
    try {
      if (demo) rehearse(action, value, id);
      else {
        const { data, error } = await client.rpc("update_agm_floor", {
          p_agm: agmId,
          p_action: action,
          p_value: value,
          p_speaker: id,
        });
        if (error) throw error;
        room = data;
      }
      feedback = message("Bilik dikemas kini.", "Room updated.");
    } catch (_) {
      feedback = message(
        "Perubahan gagal. Semak giliran dan cuba lagi.",
        "Could not save. Check the queue and retry.",
      );
    } finally {
      busy = false;
      paint();
    }
    if (!demo) await refresh();
  }
  $("play-stream").onclick = () => {
    if (!streamId) return;
    const player = document.createElement("iframe");
    player.title = text("Siaran mesyuarat", "Meeting broadcast");
    player.src = "https://www.youtube-nocookie.com/embed/" + streamId;
    player.allowFullscreen = true;
    player.referrerPolicy = "strict-origin-when-cross-origin";
    $("stream-player").replaceChildren(player);
    $("play-stream").hidden = true;
  };
  $("join").onclick = () => change("join");
  $("withdraw").onclick = () =>
    change("withdraw", null, room.speakers.find((s) => s.mine)?.id);
  $("call").onclick = () =>
    change("call", null, room.speakers.find((s) => s.state === "waiting")?.id);
  $("finish").onclick = () =>
    change("finish", null, room.speakers.find((s) => s.state === "called")?.id);
  $("caption-form").onsubmit = (e) => {
    e.preventDefault();
    change("caption", $("caption-input").value);
  };
  $("link-form").onsubmit = (e) => {
    e.preventDefault();
    const raw = $("link-input").value.trim();
    const valid = safeVideo(raw);
    if (raw && !valid) {
      feedback = message(
        "Gunakan pautan Meet, Zoom, Teams atau YouTube Live.",
        "Use a Meet, Zoom, Teams or YouTube Live link.",
      );
      paint();
      return;
    }
    change("link", valid);
  };
  async function start() {
    if (demo) {
      room = {
        title: "Koperasi Contoh · AGM",
        status: "live",
        operator: true,
        checkedIn: true,
        speakers: [],
        link: "",
        caption: "",
      };
      paint();
      return;
    }
    try {
      // Only a real room needs the config and SDK. Rehearsals work offline.
      if (!window.AGMX_CONFIG)
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "/config.js";
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      const { supabase, AGMX_API, configProblem } = await import(
        "./supabase-client.js"
      );
      if (configProblem) throw Error("config");
      if (!(await AGMX_API.isAuthenticated()))
        return unavailable(
          "Log masuk untuk memasuki bilik koperasi.",
          "Sign in to enter your cooperative’s room.",
        );
      agmId =
        params.get("agm") || (await AGMX_API.governance.current()).agm?.id;
      if (!agmId)
        return unavailable(
          "Cipta AGM di dewan terlebih dahulu.",
          "Create an AGM in the hall first.",
        );
      client = supabase;
      await refresh();
    } catch (_) {
      unavailable(
        "Sambungan ruang kerja gagal. Cuba semula atau buka raptai.",
        "Workspace connection failed. Retry or open the rehearsal.",
      );
    }
  }
  $("retry").onclick = start;
  window.addEventListener("agmx-language", paint);
  if (!demo) {
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 5000);
    window.addEventListener("pagehide", () => clearInterval(timer), {
      once: true,
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refresh();
    });
  }
  start();
})();
