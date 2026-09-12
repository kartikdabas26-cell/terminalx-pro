"""
TerminalX Pro - backend API

Run locally:
    uvicorn main:app --reload --port 8000

Run in production:
    gunicorn main:app -k uvicorn.workers.UvicornWorker -w 2 -b 0.0.0.0:$PORT
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

import market_data

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger("terminalx.main")

APP_ENV = os.environ.get("APP_ENV", "development")
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]

limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])

app = FastAPI(
    title="TerminalX Pro API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# Request/response models
# --------------------------------------------------------------------------
class AiQueryRequest(BaseModel):
    ticker: str = Field(..., max_length=12)
    question: str = Field(..., min_length=1, max_length=500)


class AiQueryResponse(BaseModel):
    answer: str


# --------------------------------------------------------------------------
# API routes
# --------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "env": APP_ENV,
        "yfinance_available": market_data.YFINANCE_AVAILABLE,
        "finnhub_configured": bool(market_data.FINNHUB_API_KEY),
    }


@app.get("/api/quote/{ticker}")
@limiter.limit("60/minute")
def quote(request: Request, ticker: str):
    try:
        return market_data.get_quote(ticker)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("quote failed")
        raise HTTPException(status_code=502, detail="Upstream data provider error") from exc


@app.get("/api/history/{ticker}")
@limiter.limit("60/minute")
def history(
    request: Request,
    ticker: str,
    period: str = Query("3mo", pattern="^(1d|1mo|3mo|1y|5y)$"),
):
    try:
        return market_data.get_history(ticker, period=period)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("history failed")
        raise HTTPException(status_code=502, detail="Upstream data provider error") from exc


@app.get("/api/financials/{ticker}")
@limiter.limit("60/minute")
def financials(request: Request, ticker: str):
    try:
        return market_data.get_financials(ticker)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("financials failed")
        raise HTTPException(status_code=502, detail="Upstream data provider error") from exc


@app.get("/api/news/{ticker}")
@limiter.limit("60/minute")
def news(request: Request, ticker: str):
    try:
        return market_data.get_news(ticker)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/ai/query", response_model=AiQueryResponse)
@limiter.limit("20/minute")
def ai_query(request: Request, payload: AiQueryRequest):
    try:
        answer = market_data.generate_ai_analysis(payload.ticker, payload.question)
        return {"answer": answer}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.exception_handler(404)
async def not_found_handler(request, exc):  # noqa: ANN001
    return JSONResponse(status_code=404, content={"detail": "Not found"})


# --------------------------------------------------------------------------
# Static frontend (served by the same process so a single deploy target
# is enough - e.g. Render/Railway/Fly/a single Docker container).
# --------------------------------------------------------------------------
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
else:  # pragma: no cover
    logger.warning("Frontend directory not found at %s - API-only mode", FRONTEND_DIR)
