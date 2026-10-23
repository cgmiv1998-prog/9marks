# 9Marks Player

A personal PWA that plays 9Marks podcasts and nothing else. No search, no browse, no discovery.

Every hour a GitHub Action finds all podcasts published by "9Marks" (via Apple's podcast directory), reads their RSS feeds, and commits `feeds.json`. The app reads that file.

## Set up (about 15 minutes, no terminal)

1. Create a new **public** GitHub repo (e.g. `9marks`).
2. Upload everything in this folder to it (drag the files into the repo page: "Add file → Upload files"). Keep the folder structure, including `.github/workflows/refresh.yml` and `icons/`. If the web uploader drops the hidden `.github` folder, use "Add file → Create new file" and type `.github/workflows/refresh.yml`, then paste the contents.
3. **Settings → Pages**: Source = "Deploy from a branch", Branch = `main`, folder = `/ (root)`. Save.
4. **Actions tab → Refresh feeds → Run workflow.** Wait about a minute. A `feeds.json` file should appear in the repo.
5. On your iPhone, open `https://YOUR-USERNAME.github.io/9marks/` in **Safari**, tap Share, then **Add to Home Screen**.

## How it behaves

- Home shows the latest 40 episodes across all shows. Chips filter to one show (every episode).
- Tap an episode to play. It resumes where you left off. Nothing plays after an episode ends.
- Controls: back 15s, forward 30s, speed (1x to 2x), mark played. Lock screen and AirPods controls are wired up.
- Progress and played state are stored on the phone only.

## Changing things

- Show more or fewer episodes per show: `episodesPerShow` in `feeds.config.json` (0 = every episode).
- Add a show that isn't published under the 9Marks name: add its Apple Podcasts ID to `appleIds` or its RSS URL to `extraFeeds`.
- After editing `app.js`, `style.css` or `index.html`, bump `VERSION` in `sw.js` so phones pick up the change.

## Known limits

- No offline listening. The app shell and the last episode list are cached; audio is streamed.
- New episodes appear within about an hour of publishing.
- GitHub may pause scheduled Actions on repos with no activity for 60 days. If episodes stop updating, re-run the workflow from the Actions tab.
