# TerminalX Pro

TerminalX Pro is an institutional-style financial workstation for researching stocks and market data.

## Features

- Live quotes and historical market data
- Interactive candlestick charts
- EMA, VWAP, Bollinger Bands, RSI, and MACD indicators
- Financial statements
- Analyst price targets
- News stream
- AI fundamentals summary
- Simulated fallback data when market APIs are unavailable
- FastAPI backend with a static frontend

## Tech Stack

- Python
- FastAPI
- yfinance
- JavaScript
- Plotly
- Docker

## Run Locally

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
