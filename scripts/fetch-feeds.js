// Builds feeds.json: every podcast published by the configured publisher (9Marks),
// plus any explicitly listed Apple IDs / feed URLs. Runs in GitHub Actions (Node 20+).
import { readFile, writeFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";

const config = JSON.parse(await readFile(new URL("../feeds.config.json", import.meta.url), "utf8"));
const LIMIT = config.episodesPerShow || Infinity; // 0 = every episode
const OUT = process.env.OUT_FILE || new URL("../feeds.json", import.meta.url).pathname;
// Test hook: FEEDS_OVERRIDE='[{"name":"x","feedUrl":"http://localhost:8123/feed.xml"}]' skips Apple lookups.
const OVERRIDE = process.env.FEEDS_OVERRIDE ? JSON.parse(process.env.FEEDS_OVERRIDE) : null;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  processEntities: true,
  trimValues: true,
});

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const text = (x) => {
  if (x == null) return "";
  if (typeof x === "object") return String(x["#text"] ?? "");
  return String(x);
};
const strip = (html) =>
  text(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

async function getJSON(url) {
  const r = await fetch(url, { headers: { "User-Agent": "nine-marks-player/1.0" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// ---- 1. Work out which feeds to read ------------------------------------
async function discoverFeeds() {
  if (OVERRIDE) return OVERRIDE;
  const found = new Map(); // key: feedUrl

  const add = (feedUrl, name, extra = {}) => {
    if (!feedUrl) return;
    if (!found.has(feedUrl)) found.set(feedUrl, { feedUrl, name, ...extra });
  };

  // a) explicit Apple IDs
  const ids = arr(config.appleIds);
  if (ids.length) {
    try {
      const d = await getJSON(`https://itunes.apple.com/lookup?id=${ids.join(",")}&entity=podcast`);
      for (const r of d.results || []) add(r.feedUrl, r.collectionName, { appleId: r.collectionId });
    } catch (e) {
      console.warn("Apple lookup failed:", e.message);
    }
  }

  // b) everything Apple lists under the publisher name (catches new / unlisted shows)
  if (config.publisher) {
    try {
      const q = encodeURIComponent(config.publisher);
      const d = await getJSON(
        `https://itunes.apple.com/search?term=${q}&media=podcast&entity=podcast&attribute=artistTerm&limit=200`
      );
      for (const r of d.results || []) {
        if ((r.artistName || "").trim().toLowerCase() === config.publisher.toLowerCase()) {
          add(r.feedUrl, r.collectionName, { appleId: r.collectionId });
        }
      }
    } catch (e) {
      console.warn("Apple publisher search failed:", e.message);
    }
  }

  // c) manual feed URLs
  for (const f of arr(config.extraFeeds)) add(f.url ?? f, f.name ?? f.url ?? f);

  return [...found.values()];
}

// ---- 2. Parse a feed -----------------------------------------------------
function toSeconds(d) {
  const s = text(d).trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function https(u) {
  return u ? u.replace(/^http:\/\//i, "https://") : u;
}

async function readFeed(meta) {
  const r = await fetch(meta.feedUrl, { headers: { "User-Agent": "nine-marks-player/1.0" } });
  if (!r.ok) throw new Error(`${r.status} ${meta.feedUrl}`);
  const xml = await r.text();
  const ch = parser.parse(xml)?.rss?.channel;
  if (!ch) throw new Error(`No RSS channel: ${meta.feedUrl}`);

  const image =
    ch["itunes:image"]?.["@_href"] || (typeof ch.image === "object" ? text(ch.image?.url) : "") || "";

  const episodes = arr(ch.item)
    .map((it) => {
      const audio = it.enclosure?.["@_url"];
      if (!audio) return null;
      const date = it.pubDate ? new Date(text(it.pubDate)) : null;
      return {
        id: `${meta.appleId || meta.feedUrl}|${text(it.guid) || audio}`,
        title: strip(it.title),
        date: date && !isNaN(date) ? date.toISOString() : "",
        duration: toSeconds(it["itunes:duration"]),
        audio: https(audio),
        image: it["itunes:image"]?.["@_href"] || "",
        description: strip(it["itunes:summary"] || it.description).slice(0, 200),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, LIMIT);

  return {
    id: String(meta.appleId || meta.feedUrl),
    name: meta.name || strip(ch.title),
    author: strip(ch["itunes:author"]),
    image: https(image),
    link: text(ch.link),
    episodes,
  };
}

// ---- 3. Build --------------------------------------------------------------
const feeds = await discoverFeeds();
if (!feeds.length) {
  console.error("No feeds found. Leaving feeds.json untouched.");
  process.exit(1);
}

const results = await Promise.allSettled(feeds.map(readFeed));
const shows = [];
results.forEach((r, i) => {
  if (r.status === "fulfilled" && r.value.episodes.length) shows.push(r.value);
  else console.warn("Skipped", feeds[i].name, r.reason?.message || "no episodes");
});

if (!shows.length) {
  console.error("Every feed failed. Leaving feeds.json untouched.");
  process.exit(1);
}

// Latest-episode order: most recently updated show first.
shows.sort((a, b) => (b.episodes[0]?.date || "").localeCompare(a.episodes[0]?.date || ""));

// "updated" only changes when content does, so the Action does not commit on every run.
let prevShows = "";
try {
  prevShows = JSON.stringify(JSON.parse(await readFile(OUT, "utf8")).shows);
} catch {}
if (prevShows === JSON.stringify(shows)) {
  console.log("No changes.");
} else {
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), shows }, null, 1));
  console.log(`Wrote ${shows.length} shows, ${shows.reduce((n, s) => n + s.episodes.length, 0)} episodes.`);
}
