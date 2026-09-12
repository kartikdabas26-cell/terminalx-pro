"""
market_data.py
----------------
Data access layer for TerminalX Pro.

Tries to pull real market data via yfinance. If that fails for any
reason (no network, ticker not found, rate limited, yfinance not
installed, etc.) it falls back to a deterministic-but-randomized
simulator so the product never shows a blank screen.

Every function returns plain dicts / lists of dicts so the FastAPI
layer can hand them straight to Pydantic models / JSONResponse.
"""

from __future__ import annotations

import logging
import math
import random
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any

logger = logging.getLogger("terminalx.market_data")

try:
    import yfinance as yf  # type: ignore

    YFINANCE_AVAILABLE = True
except Exception:  # pragma: no cover - import guard, not a logic branch
    YFINANCE_AVAILABLE = False
    logger.warning("yfinance not available - running in simulation-only mode")


# --------------------------------------------------------------------------
# Simple in-memory TTL cache so we don't hammer the upstream provider (and
# don't get rate-limited) every time a client polls the UI.
# --------------------------------------------------------------------------
_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_TTL_SECONDS = 30


def _cache_get(key: str):
    entry = _CACHE.get(key)
    if not entry:
        return None
    ts, value = entry
    if (datetime.now(timezone.utc).timestamp() - ts) > _CACHE_TTL_SECONDS:
        _CACHE.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: Any) -> None:
    _CACHE[key] = (datetime.now(timezone.utc).timestamp(), value)


# --------------------------------------------------------------------------
# Ticker validation - never trust client input.
# --------------------------------------------------------------------------
def normalize_ticker(raw: str) -> str:
    """Uppercase + strip a ticker and reject anything that isn't a
    plausible symbol. Raises ValueError on invalid input."""
    if not raw:
        raise ValueError("Ticker is required")
    cleaned = raw.strip().upper()
    if not (1 <= len(cleaned) <= 12):
        raise ValueError("Ticker must be 1-12 characters")
    # Allow letters, digits, dot and dash (covers BTC-USD, BRK.B, etc.)
    if not all(c.isalnum() or c in ".-" for c in cleaned):
        raise ValueError("Ticker contains invalid characters")
    return cleaned


# --------------------------------------------------------------------------
# Deterministic simulator (used as fallback, and for unknown tickers so the
# demo always looks alive even with no upstream data source configured).
# --------------------------------------------------------------------------
def _seeded_random(ticker: str) -> random.Random:
    return random.Random(sum(ord(c) for c in ticker))


def simulate_quote(ticker: str) -> dict:
    rnd = _seeded_random(ticker)
    base_price = round(rnd.uniform(20, 500), 2)
    change = round(rnd.uniform(-8, 8), 2)
    change_pct = round((change / base_price) * 100, 2)
    return {
        "ticker": ticker,
        "name": f"{ticker} Corp",
        "sector": "General Market Asset",
        "exchange": "NYSE/NASDAQ",
        "price": base_price,
        "change": change,
        "changePct": change_pct,
        "marketCap": f"${round(rnd.uniform(5, 900), 1)} B",
        "pe": round(rnd.uniform(8, 60), 1),
        "range52": f"${round(base_price * 0.6, 2)} - ${round(base_price * 1.4, 2)}",
        "beta": round(rnd.uniform(0.6, 2.2), 2),
        "targetLow": round(base_price * 0.8, 2),
        "targetMean": round(base_price * 1.05, 2),
        "targetHigh": round(base_price * 1.3, 2),
        "summary": "Simulated market asset - no live data source configured for this symbol.",
        "source": "simulated",
    }


def simulate_history(base_price: float, days: int) -> list[dict]:
    data = []
    current = base_price * 0.7
    now = datetime.now(timezone.utc)
    for i in range(days, -1, -1):
        date = now - timedelta(days=i)
        volatility = current * 0.025
        open_ = current + random.uniform(-0.48, 0.52) * volatility
        high = open_ + random.uniform(0, 1) * volatility
        low = open_ - random.uniform(0, 1) * volatility
        close = (high + low) / 2 + random.uniform(-0.48, 0.52) * volatility
        volume = random.randint(10_000_000, 60_000_000)
        current = close
        data.append(
            {
                "date": date.strftime("%Y-%m-%d"),
                "open": round(open_, 2),
                "high": round(high, 2),
                "low": round(low, 2),
                "close": round(close, 2),
                "volume": volume,
            }
        )
    return data


def _fallback_financials() -> dict:
    return {
        "income": [
            {"name": "Total Revenue", "y1": None, "y2": None, "y3": None, "yoy": "n/a"},
        ],
        "balance": [
            {"name": "Total Assets", "y1": None, "y2": None, "y3": None, "yoy": "n/a"},
        ],
        "cash": [
            {"name": "Free Cash Flow", "y1": None, "y2": None, "y3": None, "yoy": "n/a"},
        ],
        "source": "unavailable",
    }


# --------------------------------------------------------------------------
# Public API used by the FastAPI routes
# --------------------------------------------------------------------------
def get_quote(ticker: str) -> dict:
    ticker = normalize_ticker(ticker)
    cache_key = f"quote:{ticker}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    if YFINANCE_AVAILABLE:
        try:
            result = _quote_from_yfinance(ticker)
            _cache_set(cache_key, result)
            return result
        except Exception as exc:  # noqa: BLE001 - any provider failure -> fallback
            logger.info("yfinance quote failed for %s: %s", ticker, exc)

    result = simulate_quote(ticker)
    _cache_set(cache_key, result)
    return result


def _quote_from_yfinance(ticker: str) -> dict:
    t = yf.Ticker(ticker)
    info = t.fast_info  # lightweight, doesn't hit as many endpoints
    price = float(info.get("last_price") or 0)
    prev_close = float(info.get("previous_close") or price)
    if price <= 0:
        raise ValueError("No price data returned")

    change = price - prev_close
    change_pct = (change / prev_close * 100) if prev_close else 0.0

    # get_info() is heavier; wrap separately so a partial failure still
    # gives us a usable quote.
    full_info: dict = {}
    try:
        full_info = t.get_info() or {}
    except Exception:  # noqa: BLE001
        pass

    market_cap = info.get("market_cap")
    market_cap_str = f"${market_cap / 1e9:.2f} B" if market_cap else "n/a"

    return {
        "ticker": ticker,
        "name": full_info.get("longName") or full_info.get("shortName") or ticker,
        "sector": full_info.get("sector") or "n/a",
        "exchange": info.get("exchange") or full_info.get("exchange") or "n/a",
        "price": round(price, 2),
        "change": round(change, 2),
        "changePct": round(change_pct, 2),
        "marketCap": market_cap_str,
        "pe": round(full_info.get("trailingPE"), 2) if full_info.get("trailingPE") else "n/a",
        "range52": f"${info.get('year_low', 0):.2f} - ${info.get('year_high', 0):.2f}",
        "beta": full_info.get("beta", "n/a"),
        "targetLow": full_info.get("targetLowPrice", round(price * 0.8, 2)),
        "targetMean": full_info.get("targetMeanPrice", round(price * 1.05, 2)),
        "targetHigh": full_info.get("targetHighPrice", round(price * 1.3, 2)),
        "summary": full_info.get("longBusinessSummary", "")[:400] or "No summary available.",
        "source": "yfinance",
    }


def get_history(ticker: str, period: str = "3mo", interval: str = "1d") -> list[dict]:
    ticker = normalize_ticker(ticker)
    cache_key = f"hist:{ticker}:{period}:{interval}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    if YFINANCE_AVAILABLE:
        try:
            hist = yf.Ticker(ticker).history(period=period, interval=interval)
            if hist is not None and not hist.empty:
                candles = [
                    {
                        "date": idx.strftime("%Y-%m-%d"),
                        "open": round(float(row["Open"]), 2),
                        "high": round(float(row["High"]), 2),
                        "low": round(float(row["Low"]), 2),
                        "close": round(float(row["Close"]), 2),
                        "volume": int(row["Volume"]) if not math.isnan(row["Volume"]) else 0,
                    }
                    for idx, row in hist.iterrows()
                ]
                _cache_set(cache_key, candles)
                return candles
        except Exception as exc:  # noqa: BLE001
            logger.info("yfinance history failed for %s: %s", ticker, exc)

    days_map = {"1d": 30, "1mo": 30, "3mo": 90, "1y": 252, "5y": 500}
    days = days_map.get(period, 90)
    quote = get_quote(ticker)
    candles = simulate_history(quote["price"], days)
    _cache_set(cache_key, candles)
    return candles


def get_financials(ticker: str) -> dict:
    ticker = normalize_ticker(ticker)
    cache_key = f"fin:{ticker}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    if YFINANCE_AVAILABLE:
        try:
            result = _financials_from_yfinance(ticker)
            _cache_set(cache_key, result)
            return result
        except Exception as exc:  # noqa: BLE001
            logger.info("yfinance financials failed for %s: %s", ticker, exc)

    result = _fallback_financials()
    _cache_set(cache_key, result)
    return result


def _financials_from_yfinance(ticker: str) -> dict:
    t = yf.Ticker(ticker)
    income_df = t.income_stmt
    balance_df = t.balance_sheet
    cash_df = t.cashflow

    def rows_from(df, wanted: list[str]) -> list[dict]:
        if df is None or df.empty:
            return []
        cols = list(df.columns)[:3]  # most recent 3 periods
        out = []
        for label in wanted:
            if label not in df.index:
                continue
            values = [df.loc[label, c] for c in cols]
            values = [None if (v is None or (isinstance(v, float) and math.isnan(v))) else round(float(v) / 1_000_000, 1) for v in values]
            yoy = "n/a"
            if len(values) >= 2 and values[0] and values[1]:
                try:
                    yoy = f"{((values[0] - values[1]) / abs(values[1]) * 100):+.1f}%"
                except ZeroDivisionError:
                    yoy = "n/a"
            row = {"name": label, "yoy": yoy}
            for i, v in enumerate(values):
                row[f"y{i+1}"] = v
            out.append(row)
        return out

    income = rows_from(income_df, ["Total Revenue", "Gross Profit", "Operating Income", "Net Income"])
    balance = rows_from(balance_df, ["Cash And Cash Equivalents", "Total Assets", "Total Debt", "Stockholders Equity"])
    cash = rows_from(cash_df, ["Operating Cash Flow", "Capital Expenditure", "Free Cash Flow"])

    if not (income or balance or cash):
        raise ValueError("No financial statement data returned")

    return {"income": income, "balance": balance, "cash": cash, "source": "yfinance"}


def get_news(ticker: str) -> list[dict]:
    """Real news requires a licensed news API key (NewsAPI, Benzinga, etc.).
    Without one configured we return clearly-labelled illustrative items so
    the UI never lies about the data being live."""
    ticker = normalize_ticker(ticker)
    now = datetime.now(timezone.utc)
    return [
        {
            "title": f"{ticker}: sample headline - configure NEWS_API_KEY for live wire data",
            "source": "TerminalX Sample Feed",
            "time": now.isoformat(),
            "sentiment": "Neutral",
            "url": "#",
        }
    ]


def generate_ai_analysis(ticker: str, question: str) -> str:
    """Deterministic, template-based summary from real fundamentals.
    This is NOT a call to a hosted LLM - wire it up to your own model
    provider in this function if you want a true conversational analyst."""
    quote = get_quote(ticker)
    return (
        f"Based on available data for {ticker} ({quote['name']}):\n\n"
        f"- Price: ${quote['price']} ({quote['changePct']:+}% today)\n"
        f"- P/E: {quote['pe']} | Beta: {quote['beta']}\n"
        f"- Mean analyst target: ${quote['targetMean']}\n"
        f"- Summary: {quote['summary']}\n\n"
        f"(Data source: {quote['source']}. This is an automated fundamentals "
        f"summary, not investment advice.)"
    )
