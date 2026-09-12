# TerminalX Pro

An institutional-style financial workstation: candlestick charting with
technical indicators, multi-asset relative performance, financial
statements, analyst target gauge, an AI fundamentals-summary assistant,
and a news stream.

This repo was rebuilt from a single 1,000-line standalone HTML prototype
into a deployable client/server app. What changed and why is below.

---

## 1. Issues found in the original prototype

**Security**
- `handleAiQuery()` and `renderNewsStream()` inserted user- and
  ticker-derived strings straight into `innerHTML`. Typing something like
  `<img src=x onerror=alert(1)>` into the ticker box or the AI chat box
  executed arbitrary JavaScript in the page (stored/DOM XSS). Fixed by
  routing every dynamic string through `textContent` or an `escapeHtml()`
  helper (`frontend/js/utils.js`, `frontend/js/app.js`).
- No input validation on the ticker field - any string was accepted and
  echoed back into the DOM and into object lookups.
- Tailwind was pulled from a CDN with no version pin beyond "latest",
  and Plotly/Font Awesome were pinned to specific versions inconsistently.

**Correctness / robustness**
- `setTimeframe()` relied on the implicit global `event` object
  (`event.target...`), which is deprecated, not available in all
  browsers/execution contexts, and breaks if the function is ever called
  programmatically. Fixed by passing the button element explicitly.
- All "live" data (prices, financials, news, analyst targets) was
  `Math.random()` - there was no real data source at all, despite the UI
  labelling itself "LIVE SIMULATION". This is fine for a demo but not for
  something described as deployable; the new backend fetches real
  quotes/history/financials via `yfinance` and only falls back to
  simulation when a symbol/data point truly isn't available.
- The CSV export and financial statement table assumed exactly 3 fixed
  fiscal years (`y23/y24/y25`) hardcoded per-ticker - it silently showed
  `-` for any other symbol. Now driven by whatever periods the data
  source actually returns.
- No error handling around chart rendering, fetches, or unknown tickers
  beyond a generic placeholder object.

**Engineering / maintainability**
- Everything (~650 lines of JS) lived in one inline `<script>` block
  mixed into the HTML - no separation of concerns, no reuse, nothing
  testable in isolation.
- No backend at all - "deploying" it meant hosting a static file with
  fake data forever.
- No `.gitignore`, no dependency manifest, no Docker/deploy config, no
  environment-based configuration (API base URL, CORS origins, etc. were
  not configurable).

**Accessibility**
- Icon-only buttons and text inputs had no `aria-label`/`<label>`, and
  Tailwind's default focus-ring reset left no visible focus indicator.

## 2. What this repo contains now

```
terminalx-pro/
├── backend/
│   ├── main.py           FastAPI app: REST endpoints + serves the frontend
│   ├── market_data.py    yfinance-backed data layer with simulated fallback
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── config.js     runtime config (API base URL, poll interval)
│       ├── utils.js       escaping/formatting/toast helpers
│       ├── indicators.js  EMA/VWAP/Bollinger/RSI/MACD math (pure functions)
│       ├── charts.js      Plotly rendering
│       ├── api.js         fetch wrappers + client-side offline fallback
│       └── app.js         DOM wiring / state / event handlers
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── .gitignore
```

### API surface (backend/main.py)

| Method | Path                     | Purpose                                   |
|--------|--------------------------|--------------------------------------------|
| GET    | `/api/health`            | Liveness/readiness probe                   |
| GET    | `/api/quote/{ticker}`    | Current price + key stats                  |
| GET    | `/api/history/{ticker}`  | OHLCV candles (`?period=1d|1mo|3mo|1y|5y`) |
| GET    | `/api/financials/{ticker}` | Income/balance/cash-flow rows           |
| GET    | `/api/news/{ticker}`     | Recent company news from Finnhub when configured |
| POST   | `/api/ai/query`          | Fundamentals-based text summary            |

All routes validate and normalize the ticker server-side
(`market_data.normalize_ticker`) and are rate-limited via `slowapi`.

Quotes and company news use [Finnhub](https://finnhub.io/) when
`FINNHUB_API_KEY` is configured in `.env`. Historical prices and financial
statements use [`yfinance`](https://pypi.org/project/yfinance/), which is
free and requires no key, but is not an official, SLA-backed API. Provider
failures fall back to yfinance and then clearly-labelled simulation data.

Copy `.env.example` to `.env` and set `FINNHUB_API_KEY` for live quotes and
news. Never commit `.env` or expose the key in frontend code.

The **AI Intelligence Hub** currently returns a deterministic,
template-based summary built from the real quote data - it is *not* a
call to a hosted LLM. If you want genuine natural-language analysis,
call your model provider's API from `generate_ai_analysis()` in
`market_data.py` and keep the same return type (a string).

### Resilience

If the backend is unreachable, `frontend/js/api.js` falls back to a
deterministic client-side simulator so the UI never goes blank - it's
now an explicit fallback path (clearly labeled `source: "client-simulated"`
and surfaced to the user via a toast), not the only data source like in
the original prototype.

## 3. Running locally

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Open http://localhost:8000 - FastAPI serves the `frontend/` folder
directly, so there's nothing else to run.

## 4. Deploying

### Option A: Docker (any host - Fly.io, Render, a VPS, ECS, etc.)

```bash
docker build -t terminalx-pro .
docker run -p 8000:8000 --env-file .env terminalx-pro
```

or with Compose:

```bash
cp .env.example .env   # edit values
docker compose up -d --build
```

### Option B: Platform-as-a-service (Render / Railway / Fly.io)

1. Push this repo to GitHub.
2. Create a new Web Service pointing at the repo.
3. Build command: `pip install -r backend/requirements.txt`
4. Start command: `gunicorn main:app -k uvicorn.workers.UvicornWorker -w 2 -b 0.0.0.0:$PORT --chdir backend`
5. Set environment variables from `.env.example`, including
  `FINNHUB_API_KEY` and your production `ALLOWED_ORIGINS`.

### Option C: Vercel

The repository includes `vercel.json`, `api/index.py`, and a root
`requirements.txt` for Vercel's Python runtime.

1. Import the GitHub repository into Vercel.
2. Keep the project root set to the repository root.
3. Add `FINNHUB_API_KEY`, `APP_ENV`, and `ALLOWED_ORIGINS` under Project Settings
  > Environment Variables.
4. Deploy or redeploy the project.

The FastAPI app is available at `/`, with API routes under `/api/*`.

### Before going to production

- Set `ALLOWED_ORIGINS` to your actual domain(s) - don't ship `*` publicly.
- Put the app behind HTTPS (most PaaS providers do this for you; if you're
  on a bare VPS, put nginx/Caddy in front with a TLS cert).
- Finnhub and yfinance data may be delayed, rate-limited, or unavailable;
  validate data freshness before using this for trading decisions.
- Tailwind is still loaded from the CDN `<script src="https://cdn.tailwindcss.com">`
  build, which is fine for internal tools/MVPs but is not meant for
  high-traffic production sites (no purging, larger runtime cost). To
  harden further: run the Tailwind CLI to produce a static, purged
  `style.css` and drop the CDN `<script>` tag.
- Add authentication/authorization if this will hold anything other than
  public market data.
- Point monitoring/uptime checks at `/api/health`.

## 5. Known limitations

- No WebSocket/streaming feed - the frontend polls `/api/quote/{ticker}`
  every 15s (configurable in `frontend/js/config.js`).
- The "Analyst Recommendation Breakdown" panel remains illustrative.
- `yfinance` has no official uptime guarantee and can be rate-limited by
  Yahoo; the 30s in-memory cache in `market_data.py` reduces load but a
  multi-instance production deploy should replace it with Redis or similar.
