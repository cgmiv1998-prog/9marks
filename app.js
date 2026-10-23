(() => {
  "use strict";

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const audio = $("audio");
  const SPEEDS = [1, 1.25, 1.5, 1.75, 2];
  const LATEST_COUNT = 40;

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    },
  };

  let pos = store.get("pos", {});        // { episodeId: seconds }
  let played = store.get("played", {});  // { episodeId: true }
  let speed = store.get("speed", 1);
  let last = store.get("last", null);    // episodeId
  let hidePlayed = store.get("hidePlayed", false);
  let filter = "latest";                 // "latest" | showId
  let shows = [];
  const byId = new Map();                // episodeId -> { ep, show }
  let current = null;
  let lastSave = 0;
  let seeking = false;

  const fmt = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
  };
  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  };
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // ---------- data ----------
  async function load() {
    try {
      const res = await fetch("feeds.json", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      shows = data.shows || [];
      if (data.updated) $("updated").textContent = "Updated " + fmtDate(data.updated);
    } catch {
      $("list").replaceChildren(el("p", "muted pad", "Couldn't load episodes. Check your connection and reopen."));
      return;
    }
    for (const show of shows) for (const ep of show.episodes) byId.set(ep.id, { ep, show });
    renderChips();
    renderList();
    restoreLast();
  }

  // ---------- list ----------
  function renderChips() {
    const nav = $("chips");
    nav.replaceChildren();
    const mk = (label, key) => {
      const b = el("button", "chip", label);
      b.dataset.key = key;
      b.setAttribute("aria-pressed", String(filter === key));
      b.addEventListener("click", () => { filter = key; renderChips(); renderList(); window.scrollTo(0, 0); });
      nav.appendChild(b);
    };
    mk("Latest", "latest");
    for (const s of shows) mk(s.name.replace(/\s*[—–-]+\s*A podcast by.*$/i, "").replace(/^A podcast by.*$/i, s.name), s.id);
    const t = el("button", "chip toggle", "Hide played");
    t.setAttribute("aria-pressed", String(hidePlayed));
    t.addEventListener("click", () => { hidePlayed = !hidePlayed; store.set("hidePlayed", hidePlayed); renderChips(); renderList(); });
    nav.appendChild(t);
  }

  function visibleEpisodes() {
    let items;
    if (filter === "latest") {
      items = shows.flatMap((show) => show.episodes.map((ep) => ({ ep, show })));
      items.sort((a, b) => (b.ep.date || "").localeCompare(a.ep.date || ""));
    } else {
      const show = shows.find((s) => s.id === filter);
      items = show ? show.episodes.map((ep) => ({ ep, show })) : [];
    }
    if (hidePlayed) items = items.filter(({ ep }) => !played[ep.id] || (current && current.ep.id === ep.id));
    return filter === "latest" ? items.slice(0, LATEST_COUNT) : items;
  }

  function renderList() {
    const list = $("list");
    const items = visibleEpisodes();
    if (!items.length) { list.replaceChildren(el("p", "muted pad", "Nothing here.")); return; }
    const frag = document.createDocumentFragment();
    for (const { ep, show } of items) {
      const row = el("button", "ep");
      row.dataset.id = ep.id;
      if (played[ep.id]) row.classList.add("done");
      if (current && current.ep.id === ep.id) row.classList.add("current");

      const img = el("img");
      img.src = ep.image || show.image || "";
      img.alt = "";
      img.loading = "lazy";
      img.width = 56; img.height = 56;

      const body = el("div", "body");
      body.appendChild(el("div", "show", shortName(show.name)));
      body.appendChild(el("div", "t", ep.title));
      const bits = [fmtDate(ep.date), ep.duration ? Math.round(ep.duration / 60) + " min" : ""].filter(Boolean);
      if (played[ep.id]) bits.push("played");
      body.appendChild(el("div", "sub", bits.join(" · ")));

      const saved = pos[ep.id];
      if (saved && ep.duration && !played[ep.id]) {
        const bar = el("div", "bar"), fill = el("i");
        fill.style.width = Math.min(100, (saved / ep.duration) * 100) + "%";
        bar.appendChild(fill); body.appendChild(bar);
      }
      row.append(img, body);
      row.addEventListener("click", () => play(ep.id));
      frag.appendChild(row);
    }
    list.replaceChildren(frag);
  }

  const shortName = (n) => n.replace(/\s*[—–-]+\s*A podcast by.*$/i, "").replace(/\s*-\s*A podcast by 9Marks.*$/i, "");

  // ---------- playback ----------
  function load_(id, autoplay) {
    const hit = byId.get(id);
    if (!hit) return;
    current = hit;
    last = id; store.set("last", id);

    audio.src = hit.ep.audio;
    audio.playbackRate = speed;
    const start = pos[id] || 0;
    const onMeta = () => {
      audio.removeEventListener("loadedmetadata", onMeta);
      const d = audio.duration || hit.ep.duration || 0;
      if (start > 5 && (!d || start < d - 10)) audio.currentTime = start;
      audio.playbackRate = speed;
    };
    audio.addEventListener("loadedmetadata", onMeta);
    audio.load();
    if (autoplay) audio.play().catch(() => {});

    $("player").hidden = false;
    $("title").textContent = hit.ep.title;
    $("show").textContent = shortName(hit.show.name);
    $("art").src = hit.ep.image || hit.show.image || "";
    $("seek").max = hit.ep.duration || 1;
    $("seek").value = start;
    paintSeek();
    $("cur").textContent = fmt(start);
    $("dur").textContent = fmt(hit.ep.duration);
    updateSpeedBtn();
    updatePlayedBtn();
    setMediaSession(hit);
    renderList();
  }

  function play(id) {
    if (current && current.ep.id === id) { toggle(); return; }
    save(true);
    load_(id, true);
  }
  const restoreLast = () => { if (last && byId.has(last)) load_(last, false); };

  function toggle() { if (!current) return; audio.paused ? audio.play().catch(() => {}) : audio.pause(); }
  function skip(delta) {
    if (!current) return;
    const d = audio.duration || current.ep.duration || Infinity;
    audio.currentTime = Math.min(Math.max(0, audio.currentTime + delta), d);
  }

  function save(force) {
    if (!current) return;
    const now = Date.now();
    if (!force && now - lastSave < 5000) return;
    lastSave = now;
    const t = audio.currentTime;
    if (t > 0 && !isNaN(t)) { pos[current.ep.id] = Math.floor(t); store.set("pos", pos); }
  }

  function markPlayed(id, value) {
    if (value) { played[id] = true; delete pos[id]; } else { delete played[id]; }
    store.set("played", played); store.set("pos", pos);
    updatePlayedBtn();
    renderList();
  }

  function paintSeek() {
    const s = $("seek");
    const max = Number(s.max) || 1;
    s.style.setProperty("--p", (Number(s.value) / max) * 100 + "%");
  }
  function updateSpeedBtn() {
    $("speed").textContent = (speed === 1 ? "1" : String(speed)) + "×";
    $("speed").classList.toggle("on", speed !== 1);
  }
  function updatePlayedBtn() {
    $("played").classList.toggle("on", !!(current && played[current.ep.id]));
  }

  // ---------- audio events ----------
  audio.addEventListener("play", () => { $("icon-play").hidden = true; $("icon-pause").hidden = false; $("play").setAttribute("aria-label", "Pause"); setPlaybackState("playing"); });
  audio.addEventListener("pause", () => { $("icon-play").hidden = false; $("icon-pause").hidden = true; $("play").setAttribute("aria-label", "Play"); setPlaybackState("paused"); save(true); });
  audio.addEventListener("durationchange", () => {
    if (!current || !isFinite(audio.duration)) return;
    $("seek").max = audio.duration; $("dur").textContent = fmt(audio.duration); paintSeek();
  });
  audio.addEventListener("timeupdate", () => {
    if (!current || seeking) return;
    $("seek").value = audio.currentTime; $("cur").textContent = fmt(audio.currentTime); paintSeek();
    save(false);
    updatePositionState();
  });
  audio.addEventListener("ended", () => {
    // Restraint: finish, mark played, stop. No autoplay of anything else.
    if (current) markPlayed(current.ep.id, true);
  });
  audio.addEventListener("error", () => { $("show").textContent = "Couldn't play this episode."; });
  document.addEventListener("visibilitychange", () => { if (document.hidden) save(true); });
  window.addEventListener("pagehide", () => save(true));

  // ---------- controls ----------
  $("play").addEventListener("click", toggle);
  $("back").addEventListener("click", () => skip(-15));
  $("fwd").addEventListener("click", () => skip(30));
  $("speed").addEventListener("click", () => {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] || 1;
    audio.playbackRate = speed; store.set("speed", speed); updateSpeedBtn();
  });
  $("played").addEventListener("click", () => { if (current) markPlayed(current.ep.id, !played[current.ep.id]); });

  const seek = $("seek");
  const startSeek = () => { seeking = true; };
  const endSeek = () => { seeking = false; audio.currentTime = Number(seek.value); save(true); };
  seek.addEventListener("input", () => { $("cur").textContent = fmt(seek.value); paintSeek(); });
  seek.addEventListener("pointerdown", startSeek);
  seek.addEventListener("touchstart", startSeek, { passive: true });
  seek.addEventListener("change", endSeek);

  // ---------- Media Session (lock screen, AirPods, Control Center) ----------
  function setMediaSession({ ep, show }) {
    if (!("mediaSession" in navigator)) return;
    const art = ep.image || show.image;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: ep.title,
      artist: shortName(show.name),
      album: "9Marks",
      artwork: art ? [{ src: art, sizes: "512x512" }] : [],
    });
  }
  function setPlaybackState(state) { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = state; }
  function updatePositionState() {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
    const d = audio.duration;
    if (!isFinite(d) || d <= 0) return;
    try { navigator.mediaSession.setPositionState({ duration: d, playbackRate: audio.playbackRate, position: Math.min(audio.currentTime, d) }); } catch {}
  }
  if ("mediaSession" in navigator) {
    const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch {} };
    set("play", () => audio.play().catch(() => {}));
    set("pause", () => audio.pause());
    set("seekbackward", (d) => skip(-(d && d.seekOffset || 15)));
    set("seekforward", (d) => skip(d && d.seekOffset || 30));
    set("seekto", (d) => { if (d && typeof d.seekTime === "number") audio.currentTime = d.seekTime; });
    set("previoustrack", () => skip(-15)); // no queue by design; map to skip
    set("nexttrack", () => skip(30));
  }

  // ---------- boot ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  load();
})();
