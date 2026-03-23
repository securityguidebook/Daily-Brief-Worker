# Daily Brief — Cloudflare Worker

> Secure API proxy and scheduler for the [Daily Brief](https://securityguidebook.github.io/daily-brief) intelligence briefing agent.

---

## Overview

This Cloudflare Worker sits between the Daily Brief frontend and the Anthropic API. It handles three responsibilities:

- **Proxy** — accepts requests from the Daily Brief web app and forwards them to Anthropic with the API key injected server-side, so the key is never exposed in the browser
- **Scheduler** — fires automatically at **6:00 AM** and **5:00 PM NZT** each day to generate and cache a fresh briefing
- **API** — exposes a `/brief` endpoint for [Daily Digivolve](https://github.com/securityguidebook/daily-digivolve) to consume the latest cached brief on demand

## Architecture

```
Daily Brief (GitHub Pages)
    │
    ▼  POST /generate
Cloudflare Worker  ◄──── Cron: 6AM & 5PM NZT
    │
    ▼
Anthropic API (claude-sonnet + web_search)
    │
    ▼
Cloudflare KV (brief cache, 25hr TTL)
    │
    ▼  GET /brief
Daily Digivolve (future integration)
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/generate` | Generate a fresh briefing (called by the web app) |
| `GET` | `/brief` | Fetch the latest cached brief (for Daily Digivolve) |
| `GET` | `/health` | Worker health check |

### POST /generate — request body

```json
{
  "topics": ["Cybersecurity", "AI & Machine Learning"],
  "depth": 3,
  "excludes": "",
  "userContext": "",
  "tldrGlobal": true,
  "tldrEu": true
}
```

### GET /brief — response shape

```json
{
  "generatedAt": "2025-03-23T18:00:00.000Z",
  "date": "Sunday, 23 March 2025",
  "topics": ["Cybersecurity", "AI & Machine Learning"],
  "markdown": "## 🔐 Cybersecurity\n...",
  "summary": "Today's top stories: CVE-2025-XXXX · EU AI Act update · NZ election"
}
```

The `summary` field is a pre-formatted one-liner suitable for a Daily Digivolve avatar greeting.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Runtime | Cloudflare Workers (V8 isolates) |
| Scheduler | Cloudflare Cron Triggers |
| Cache | Cloudflare KV |
| AI | Anthropic Claude Sonnet + web search |

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full step-by-step guide.

**Quick version:**

```bash
npm install -g wrangler
wrangler login
npx wrangler kv:namespace create BRIEF_CACHE   # paste ID into wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ALLOWED_ORIGIN         # your GitHub Pages URL
npx wrangler deploy
```

## Environment variables

| Variable | Description | How to set |
|----------|-------------|------------|
| `ANTHROPIC_API_KEY` | Anthropic API key | `wrangler secret put` |
| `ALLOWED_ORIGIN` | GitHub Pages URL for CORS | `wrangler secret put` |
| `BRIEF_CACHE` | KV namespace binding | `wrangler.toml` |

Secrets are stored encrypted in Cloudflare — never committed to this repo.

## Local development

Create a `.dev.vars` file (gitignored) for local secrets:

```
ANTHROPIC_API_KEY=sk-ant-...
ALLOWED_ORIGIN=http://localhost:5500
```

Then run:

```bash
npx wrangler dev
```

The Worker runs at `http://localhost:8787`. To test the cron trigger locally:

```bash
npx wrangler dev --test-scheduled
# in a second terminal:
curl "http://localhost:8787/__scheduled?cron=0+18+*+*+*"
```

## Daily Digivolve integration

When ready, add to your Digivolve avatar initialisation:

```js
// ── DIGIVOLVE INTEGRATION POINT ──────────────────────────────
// GET /brief  →  call this from Daily Digivolve on avatar init
// Response shape: { summary, markdown, date, generatedAt, topics }
// No auth required for read — add bearer token here if going to prod
// ─────────────────────────────────────────────────────────────

const res = await fetch('https://daily-brief-worker.YOUR_NAME.workers.dev/brief');
const brief = await res.json();

avatar.greet(brief.summary);
// → "Today's top stories: CVE-2025-XXXX · EU AI Act update · NZ election"
```

No changes needed to this Worker. The `/brief` endpoint is already live and waiting.

## Security

- API key injected server-side — never touches the browser
- CORS locked to `ALLOWED_ORIGIN` — other origins are blocked
- KV stores only generated brief text — no user data retained
- Brief cache expires after 25 hours automatically

## Related repos

- [daily-brief](https://github.com/securityguidebook/daily-brief) — the frontend web app
- [daily-digivolve](https://github.com/securityguidebook/daily-digivolve) — avatar productivity companion (future integration)

---

*Part of the [securityguidebook](https://github.com/securityguidebook) portfolio.*
