/**
 * Daily Brief — Cloudflare Worker
 * ─────────────────────────────────────────────────────────────────
 * Handles three jobs:
 *   1. PROXY   — accepts requests from the Daily Brief HTML app
 *                and forwards them to Anthropic with the API key
 *   2. CRON    — triggers briefing generation at 6AM and 5PM NZT
 *                (18:00 UTC and 05:00 UTC)
 *   3. API     — returns clean JSON for Daily Digivolve to consume
 *
 * Environment variables (set in Cloudflare dashboard → Workers → Settings):
 *   ANTHROPIC_API_KEY   — your Anthropic API key
 *   ALLOWED_ORIGIN      — your GitHub Pages URL, e.g. https://securityguidebook.github.io
 *
 * KV Namespace (bind in dashboard as BRIEF_CACHE):
 *   Stores the last generated brief so Daily Digivolve can fetch
 *   it on demand without triggering a new generation.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';

// NZT = UTC+12 — cron fires at 18:00 UTC (6AM NZT) and 05:00 UTC (5PM NZT)
const DEFAULT_TOPICS = [
  'Cybersecurity',
  'AI & Machine Learning',
  'Geopolitics',
  'Technology industry',
  'New Zealand news',
  'Australia news',
];

const TLDR_SOURCES = [
  'TLDR News Global (YouTube channel @TLDRNewsGlobal)',
  'TLDR News EU (YouTube channel @TLDRNewsEU)',
];

// ─── MAIN HANDLER ────────────────────────────────────────────────

export default {

  // HTTP requests (from Daily Brief app or Daily Digivolve)
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // CORS — allow your GitHub Pages domain and localhost for dev
    const allowedOrigins = [
      env.ALLOWED_ORIGIN,
      'http://localhost:3000',
      'http://127.0.0.1:5500', // Live Server default
    ].filter(Boolean);

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0] || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ── GET /brief ───────────────────────────────────────────────
    // Daily Digivolve calls this to fetch the latest cached brief
    // without triggering a new generation.
    if (request.method === 'GET' && url.pathname === '/brief') {
      return handleGetBrief(env, corsHeaders);
    }

    // ── POST /generate ───────────────────────────────────────────
    // Daily Brief HTML app calls this to generate a new briefing.
    // Body: { topics, depth, excludes, userContext, tldrGlobal, tldrEu }
    if (request.method === 'POST' && url.pathname === '/generate') {
      return handleGenerate(request, env, corsHeaders);
    }

    // ── GET /health ──────────────────────────────────────────────
    if (url.pathname === '/health') {
      return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() }, corsHeaders);
    }

    return jsonResponse({ error: 'Not found' }, corsHeaders, 404);
  },

  // Cron triggers (scheduled in wrangler.toml)
  async scheduled(event, env) {
    console.log(`Cron triggered: ${event.cron} at ${new Date().toISOString()}`);
    await generateAndCache(env, DEFAULT_TOPICS, 3, true, true);
  },
};

// ─── ROUTE HANDLERS ──────────────────────────────────────────────

async function handleGetBrief(env, corsHeaders) {
  try {
    const cached = await env.BRIEF_CACHE.get('latest_brief', { type: 'json' });
    if (!cached) {
      return jsonResponse({ error: 'No brief generated yet. Trigger /generate first.' }, corsHeaders, 404);
    }
    return jsonResponse(cached, corsHeaders);
  } catch (err) {
    return jsonResponse({ error: 'KV read failed: ' + err.message }, corsHeaders, 500);
  }
}

async function handleGenerate(request, env, corsHeaders) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, corsHeaders, 400);
  }

  const {
    topics = DEFAULT_TOPICS,
    depth = 3,
    excludes = '',
    userContext = '',
    tldrGlobal = true,
    tldrEu = true,
  } = body;

  try {
    const result = await generateAndCache(env, topics, depth, tldrGlobal, tldrEu, excludes, userContext);
    return jsonResponse(result, corsHeaders);
  } catch (err) {
    return jsonResponse({ error: err.message }, corsHeaders, 500);
  }
}

// ─── CORE GENERATION ─────────────────────────────────────────────

async function generateAndCache(env, topics, depth, tldrGlobal, tldrEu, excludes = '', userContext = '') {
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Pacific/Auckland'
  });

  const depthLabel = depth === 1
    ? 'headline only (1 sentence)'
    : depth >= 5
    ? '5–6 sentences, deeper analysis'
    : '3–4 sentences per story';

  const tldrSources = [
    ...(tldrGlobal ? [TLDR_SOURCES[0]] : []),
    ...(tldrEu ? [TLDR_SOURCES[1]] : []),
  ];

  const tldrInstruction = tldrSources.length > 0 ? `
TLDR News Integration:
- Search for the latest uploads and video descriptions from: ${tldrSources.join(' and ')}.
- Use search queries like "TLDR News Global latest" and/or "TLDR News EU latest".
- Add a dedicated section at the top:

## 📺 TLDR News Roundup
[3–5 bullet points per channel. Note which channel each is from.]

---
` : '';

  const systemPrompt = `You are a personal intelligence briefing agent for a cybersecurity professional based in Bangkok, targeting Australian SOC and Security Engineer roles. You write crisp, high-signal daily newsletters.

${tldrInstruction}Structure your output exactly as:

## [Emoji] [Topic Name]
**[Headline]** — *[Source]*
[Summary: ${depthLabel}]
*Why it matters:* [1 sentence]

(2–3 stories per topic, highest signal first)

---

## 📡 Worth watching this week
- [2–3 slow-burn developments]

Rules:
- Stories from last 24–48 hours only
- Prefer Reuters, AP, official reports, research papers
- Direct, no fluff. Reader is intelligent and time-poor.
- If a topic has no news today, say so in one line and move on
- Where TLDR News covered a story you also cover, note "(also: TLDR)" after the source
${excludes ? `- Exclude: ${excludes}` : ''}
${userContext ? `- Extra context: ${userContext}` : ''}`;

  const userPrompt = `Today is ${today}. Generate my intelligence briefing for: ${topics.join(', ')}.
Depth: ${depthLabel}.
${tldrSources.length > 0 ? `Also search for latest content from ${tldrSources.join(' and ')} and include the TLDR Roundup section first.` : ''}`;

  const anthropicResponse = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!anthropicResponse.ok) {
    const err = await anthropicResponse.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic API error ${anthropicResponse.status}`);
  }

  const data = await anthropicResponse.json();
  const markdown = data.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  // Structured result — Daily Brief app gets `markdown`, Daily Digivolve gets the full object
  const result = {
    generatedAt: new Date().toISOString(),
    date: today,
    topics,
    markdown,                      // full formatted brief
    summary: extractSummary(markdown), // short version for Digivolve avatar
  };

  // Cache in KV — 25 hour TTL so stale briefs don't linger past the next generation
  if (env.BRIEF_CACHE) {
    await env.BRIEF_CACHE.put('latest_brief', JSON.stringify(result), { expirationTtl: 90000 });
  }

  return result;
}

// ─── HELPERS ─────────────────────────────────────────────────────

/**
 * Extracts a short plain-text summary suitable for a Digivolve
 * avatar greeting — first 3 topic headlines, no markdown.
 */
function extractSummary(markdown) {
  const headlines = [];
  const lines = markdown.split('\n');
  for (const line of lines) {
    const match = line.match(/^\*\*(.+?)\*\*/);
    if (match) {
      headlines.push(match[1].replace(/\s*—.*$/, '').trim());
      if (headlines.length >= 3) break;
    }
  }
  return headlines.length > 0
    ? `Today's top stories: ${headlines.join(' · ')}`
    : 'Your daily brief is ready.';
}

function jsonResponse(data, extraHeaders = {}, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}
