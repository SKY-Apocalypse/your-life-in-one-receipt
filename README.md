# Threads — Your Life, In Receipts

An interactive reading of one person's digital life, rebuilt from eleven
years of listening history and a household spending ledger. Built for the
*Your Life, In Receipts* hackathon brief.

**[Live demo →](#deployment)** (add your deployed link here once published)

---

## What this is

The brief asks for raw receipts turned into a story: not a timeline, but
discoverable connections between different kinds of moments. This project
does that in four views over one derived "life graph":

- **Field** — a zoomable canvas with five lanes (listening, places, spending,
  screens, money in), receipts drawn as sized dots, and threads drawn between
  ones that belong together. Drag through time, scroll to zoom, click
  anything.
- **Chapters** — seven stretches of the eleven years, found by looking for
  the month behaviour actually changed (listening hours, night-time share,
  skip rate, taste breadth), then described from those numbers.
- **Moments** — 220 scenes reconstructed by grouping receipts of different
  kinds that happened within a few hours of each other, narrated in plain
  language.
- **Patterns** — artists who burned bright and disappeared, songs played on
  loop inside a single sitting, a yearly pulse chart, and a 24-hour listening
  clock.
- **Play the story** — a guided walk through all seven chapters, each landing
  on a real reconstructed moment.

## The data

Two real personal exports and one synthetic dataset, layered together:

| Source | What it is | Span |
|---|---|---|
| `spotify_history.csv` | ~150,000 track plays | Jul 2013 – Dec 2024 |
| `Daily Household Transactions.csv` | ~2,460 household ledger entries (Mumbai) | Jan 2015 – Sep 2018 |
| `Augmented_IndiaTransactMultiFacet2024.csv` | Synthetic card-transaction data | 2022 – 2024 |

The first two datasets overlap 2015–2018 and plausibly describe one person,
which is what makes cross-domain connection meaningful. The third does not
belong to the same person — it's a synthetic fraud-detection dataset with
thousands of different identities. It's sampled (~14 rows/month) and used
only to give the 2022–24 stretch a spending signal, since the real household
ledger ends in 2018 and Spotify would otherwise be the only source for those
years. This is disclosed here rather than hidden: the honest framing is
"real listening history + real household ledger, extended in the final two
years with a synthetic spending signal."

None of the raw CSVs are committed to this repo (see `.gitignore`) — they're
Kaggle exports with their own licensing. Download links:

- Spotify history: search "Spotify listening history" on Kaggle
- Daily Household Transactions: search that exact name on Kaggle
- Augmented India Transact Multi-Facet 2024: search that exact name on Kaggle

Place all three under `data/raw/` using the filenames referenced in
`data/build.py`.

## How the derivation works

All of the "insight" is produced once, offline, by `data/build.py`, and
shipped to the frontend as a static `data.json`. Nothing is computed live —
the browser only reads and renders.

1. **Sessions.** 150k individual plays are collapsed into listening sessions
   (a 45-minute gap ends a session) — the real unit of "what happened one
   night," not a raw play log.
2. **Receipts.** Household and card rows are classified into `purchase`,
   `media`, `place`, or `event` by keyword and pattern matching. The
   heaviest/most significant listening sessions are sampled down to a
   browsable ~2,000, weighted toward long, focused, or late-night sessions.
3. **Threads.** Three kinds of edges are drawn between receipts:
   `moment` (different kinds of receipt within a 3-hour window),
   `echo` (the same artist resurfacing after 365+ days of silence), and
   `place` (receipts naming the same location string).
4. **Moments.** Connected components over `moment` threads, capped in size,
   become one reconstructed scene — narrated in a sentence built from its
   pieces (what played, where, what was spent).
5. **Chapters.** A recursive change-point search over four monthly features
   (listening hours, night-time share, skip rate, artist variety) finds
   where behaviour actually shifted. Each resulting stretch is labelled and
   described from its own numbers — not hand-written — with rules that
   compare a stretch to the one before it (a skip-rate collapse becomes
   "The Turn," a rise back up becomes "The Drift Back"). Adjacent stretches
   that land on the same description are merged and re-labelled.
6. **Patterns.** Artist "ghosts" (an artist with a clear peak month that then
   goes quiet for 300+ days), on-repeat tracks, the monthly pulse, and the
   24-hour clock are computed directly from the session table.

Re-run the whole pipeline with:

```bash
cd data
python3 build.py      # writes data/data.json
```

## Project structure

```
├── data/
│   ├── build.py        # the derivation pipeline (see above)
│   ├── data.json        # its output — the only thing the frontend reads
│   └── raw/              # put the three source CSVs here (gitignored)
├── src/
│   ├── index.html        # shell with placeholder comments for the build step
│   ├── styles.css        # all styling, light + dark theme via CSS variables
│   └── app.js             # the whole app: field renderer, views, story mode
├── build_site.py          # inlines src/ + data/data.json → dist/index.html
├── dist/
│   └── index.html         # the single deployable file (generated)
└── .github/workflows/
    └── deploy.yml          # builds and deploys dist/ to GitHub Pages on push
```

`dist/index.html` is fully self-contained — CSS, JS, and all ~1.3MB of
derived data inlined into one file. No build tooling, no dependencies, no
external requests besides two Google Fonts. It runs by opening it directly
in a browser.

## Running locally

Nothing to install. Either:

```bash
open dist/index.html          # macOS
# or
python3 -m http.server 8000   # then visit localhost:8000/dist/
```

To rebuild after editing `src/`:

```bash
python3 build_site.py
```

## Deployment

### GitHub Pages (automatic, recommended)

This repo ships a workflow (`.github/workflows/deploy.yml`) that rebuilds
`dist/index.html` and deploys it on every push to `main`.

1. Push this repo to GitHub.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the **Actions** tab).
4. Your site is live at `https://<username>.github.io/<repo>/`.

### Netlify / Vercel (manual, fastest)

Drag `dist/index.html` onto [app.netlify.com/drop](https://app.netlify.com/drop),
or run `vercel dist/index.html` — either gives you a live URL in seconds
since there's nothing to build.

## Stack

Vanilla HTML/CSS/JS — no framework, no bundler. The derivation pipeline is
Python (pandas + numpy). Chosen deliberately for a 6-hour build: zero
install friction, zero build-step debugging, and a single file that's
trivial to deploy anywhere.

## Known limitations

- The 2022–24 spending signal is synthetic (see **The data** above).
- Household ledger place names are pre-anonymised in the source dataset
  (`Place 0`, `Place 2`, etc.) — the app surfaces them as-is rather than
  inventing real place names.
- The field view applies level-of-detail thinning when zoomed out across
  the full eleven years (it says so in the on-screen hint); zoom into any
  stretch to see every receipt.
