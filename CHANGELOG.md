# Changelog — daily-brief-worker

All notable changes to the Daily Brief Cloudflare Worker will be documented here.
Format: `[version] - YYYY-MM-DD — description`

---

## [1.0.1] - 2026-03-23
### Fixed
- `package.json` filename casing corrected from `Package.json` to `package.json` — Cloudflare build was failing to detect it on Linux (case-sensitive filesystem)
- KV namespace ID placeholder `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` replaced with real namespace ID in `wrangler.toml`

### Deployment
- Worker successfully deployed to `https://daily-brief-worker.pgtmk101.workers.dev`
- `/health` endpoint confirmed live and returning `{"status":"ok"}`
- KV namespace `BRIEF_CACHE` created and bound
- Secrets `ANTHROPIC_API_KEY` and `ALLOWED_ORIGIN` set via Cloudflare dashboard

---

## [1.0.0] - 2026-03-23
### Added
- Initial release of the Daily Brief Cloudflare Worker
- `POST /generate` — accepts topic config from frontend, builds prompt, calls Anthropic API with web search, returns structured JSON response
- `GET /brief` — returns latest cached brief from KV for Daily Digivolve integration
- `GET /health` — health check endpoint
- Cron triggers: `0 18 * * *` (6AM NZT) and `0 5 * * *` (5PM NZT)
- KV caching with 25-hour TTL via `BRIEF_CACHE` namespace
- CORS restricted to `ALLOWED_ORIGIN` secret
- API key injected server-side — never exposed to browser
- TLDR News Global and EU search integration via prompt instructions
- `summary` field in response — pre-formatted one-liner for Daily Digivolve avatar greeting
- Default topics: Cybersecurity, AI & ML, Geopolitics, Tech industry, NZ news, AU news
- Wrangler v3 configured (upgrade to v4 noted as future task)

### Security
- `ANTHROPIC_API_KEY` stored as encrypted Cloudflare secret
- `ALLOWED_ORIGIN` stored as encrypted Cloudflare secret
- No user data retained — KV stores generated brief text only

### Future integration point
- `GET /brief` endpoint ready for Daily Digivolve webapp to consume on avatar initialisation
- Response shape documented in `README.md` and `docs/DEPLOYMENT.md`
