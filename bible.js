// Bible book table + leading-passage parser for Bible Talk episode titles.
// Works in the browser (window.Bible) and in Node (require) so it can be tested.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Bible = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // [name, chapters, testament, extra aliases]
  const BOOKS = [
    ["Genesis", 50, "OT"], ["Exodus", 40, "OT"], ["Leviticus", 27, "OT"], ["Numbers", 36, "OT"],
    ["Deuteronomy", 34, "OT"], ["Joshua", 24, "OT"], ["Judges", 21, "OT"], ["Ruth", 4, "OT"],
    ["1 Samuel", 31, "OT"], ["2 Samuel", 24, "OT"], ["1 Kings", 22, "OT"], ["2 Kings", 25, "OT"],
    ["1 Chronicles", 29, "OT"], ["2 Chronicles", 36, "OT"], ["Ezra", 10, "OT"], ["Nehemiah", 13, "OT"],
    ["Esther", 10, "OT"], ["Job", 42, "OT"], ["Psalms", 150, "OT", ["Psalm"]], ["Proverbs", 31, "OT"],
    ["Ecclesiastes", 12, "OT"], ["Song of Solomon", 8, "OT", ["Song of Songs", "Song"]],
    ["Isaiah", 66, "OT"], ["Jeremiah", 52, "OT"], ["Lamentations", 5, "OT"], ["Ezekiel", 48, "OT"],
    ["Daniel", 12, "OT"], ["Hosea", 14, "OT"], ["Joel", 3, "OT"], ["Amos", 9, "OT"], ["Obadiah", 1, "OT"],
    ["Jonah", 4, "OT"], ["Micah", 7, "OT"], ["Nahum", 3, "OT"], ["Habakkuk", 3, "OT"], ["Zephaniah", 3, "OT"],
    ["Haggai", 2, "OT"], ["Zechariah", 14, "OT"], ["Malachi", 4, "OT"],
    ["Matthew", 28, "NT"], ["Mark", 16, "NT"], ["Luke", 24, "NT"], ["John", 21, "NT"], ["Acts", 28, "NT"],
    ["Romans", 16, "NT"], ["1 Corinthians", 16, "NT"], ["2 Corinthians", 13, "NT"], ["Galatians", 6, "NT"],
    ["Ephesians", 6, "NT"], ["Philippians", 4, "NT"], ["Colossians", 4, "NT"], ["1 Thessalonians", 5, "NT"],
    ["2 Thessalonians", 3, "NT"], ["1 Timothy", 6, "NT"], ["2 Timothy", 4, "NT"], ["Titus", 3, "NT"],
    ["Philemon", 1, "NT"], ["Hebrews", 13, "NT"], ["James", 5, "NT"], ["1 Peter", 5, "NT"], ["2 Peter", 3, "NT"],
    ["1 John", 5, "NT"], ["2 John", 1, "NT"], ["3 John", 1, "NT"], ["Jude", 1, "NT"],
    ["Revelation", 22, "NT", ["Revelations"]],
  ].map(([name, chapters, testament, aliases], i) => ({ name, chapters, testament, order: i, aliases: aliases || [] }));

  const byName = new Map(BOOKS.map((b) => [b.name, b]));

  // Every accepted spelling -> book. "1 John", "1st John", "First John", "I John" all work.
  const ordinal = { 1: ["1", "1st", "First", "I"], 2: ["2", "2nd", "Second", "II"], 3: ["3", "3rd", "Third", "III"] };
  const spellings = [];
  for (const b of BOOKS) {
    for (const base of [b.name, ...b.aliases]) {
      const m = base.match(/^([123]) (.+)$/);
      if (m) for (const o of ordinal[m[1]]) spellings.push([`${o} ${m[2]}`, b]);
      else spellings.push([base, b]);
    }
  }
  spellings.sort((a, b) => b[0].length - a[0].length); // longest first so "Song of Solomon" beats "Song"
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lookup = new Map(spellings.map(([s, b]) => [s.toLowerCase(), b]));
  const RE = new RegExp(
    "^\\s*(" + spellings.map(([s]) => esc(s)).join("|") + ")\\s+(\\d+)(?::(\\d+))?(?:\\s*-\\s*(\\d+)(?::(\\d+))?)?",
    "i"
  );

  // Reads the passage at the START of a title only, so a joke like "…Genesis 9:3" later on is ignored.
  // Returns { book, from, to } (chapters, inclusive) or null.
  function parseLeading(title) {
    const t = String(title || "").replace(/[‐-―−]/g, "-");
    const m = t.match(RE);
    if (!m) return null;
    const book = lookup.get(m[1].toLowerCase());
    if (!book) return null;
    const startCh = Number(m[2]);
    const hasStartVerse = m[3] != null;
    const endNum = m[4] != null ? Number(m[4]) : null;
    const endHasVerse = m[5] != null;

    // Single-chapter books (Jude, Philemon, 2 & 3 John, Obadiah): every number is a verse.
    if (book.chapters === 1) return { book: book.name, from: 1, to: 1 };

    let from = startCh;
    let to = startCh;
    if (endNum != null) {
      if (endHasVerse) to = endNum;            // "1:1-3:19" -> chapter 3
      else if (!hasStartVerse) to = endNum;    // "25-26"    -> chapter 26
      // else "5:1-5" is a verse range inside one chapter
    }
    if (to < from) to = from;
    if (from < 1 || from > book.chapters) return null;
    to = Math.min(to, book.chapters);
    return { book: book.name, from, to };
  }

  return { BOOKS, byName, parseLeading };
});
