/* Thin API client. Every call to the backend is wrapped so a network
 * failure (backend down, offline demo, CORS misconfig, etc.) degrades
 * to a client-side simulation instead of leaving the UI blank - the
 * same resilience the original hardcoded-mock version had, but now
 * it's a deliberate fallback path instead of the *only* data source. */

const TerminalXApi = (() => {
    const base = () => window.TERMINALX_CONFIG.API_BASE;

    async function getJson(path) {
        const res = await fetch(`${base()}${path}`, { headers: { Accept: 'application/json' } });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.detail || `Request failed (${res.status})`);
        }
        return res.json();
    }

    async function postJson(path, payload) {
        const res = await fetch(`${base()}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.detail || `Request failed (${res.status})`);
        }
        return res.json();
    }

    // ---- Deterministic client-side fallback (mirrors backend/market_data.py) ----
    function seededRandom(seedStr) {
        let seed = 0;
        for (const ch of seedStr) seed += ch.charCodeAt(0);
        return () => {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };
    }

    function simulateQuote(ticker) {
        const rnd = seededRandom(ticker);
        const price = +(rnd() * 480 + 20).toFixed(2);
        const change = +((rnd() - 0.5) * 16).toFixed(2);
        return {
            ticker,
            name: `${ticker} Corp`,
            sector: 'General Market Asset',
            exchange: 'NYSE/NASDAQ',
            price,
            change,
            changePct: +((change / price) * 100).toFixed(2),
            marketCap: `$${(rnd() * 900 + 5).toFixed(1)} B`,
            pe: +(rnd() * 52 + 8).toFixed(1),
            range52: `$${(price * 0.6).toFixed(2)} - $${(price * 1.4).toFixed(2)}`,
            beta: +(rnd() * 1.6 + 0.6).toFixed(2),
            targetLow: +(price * 0.8).toFixed(2),
            targetMean: +(price * 1.05).toFixed(2),
            targetHigh: +(price * 1.3).toFixed(2),
            summary: 'Offline demo mode - backend API unreachable, showing simulated data.',
            source: 'client-simulated',
        };
    }

    function simulateHistory(basePrice, days) {
        const data = [];
        let current = basePrice * 0.7;
        const now = new Date();
        for (let i = days; i >= 0; i--) {
            const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const volatility = current * 0.025;
            const open = current + (Math.random() - 0.48) * volatility;
            const high = open + Math.random() * volatility;
            const low = open - Math.random() * volatility;
            const close = (high + low) / 2 + (Math.random() - 0.48) * volatility;
            const volume = Math.floor(Math.random() * 50000000) + 10000000;
            current = close;
            data.push({
                date: date.toISOString().split('T')[0],
                open: +open.toFixed(2),
                high: +high.toFixed(2),
                low: +low.toFixed(2),
                close: +close.toFixed(2),
                volume,
            });
        }
        return data;
    }

    const PERIOD_DAYS = { '1d': 30, '1mo': 30, '3mo': 90, '1y': 252, '5y': 500 };

    return {
        async getQuote(ticker) {
            try {
                return await getJson(`/quote/${encodeURIComponent(ticker)}`);
            } catch (err) {
                console.warn('Falling back to simulated quote:', err.message);
                return simulateQuote(ticker);
            }
        },

        async getHistory(ticker, period = '3mo') {
            try {
                return await getJson(`/history/${encodeURIComponent(ticker)}?period=${encodeURIComponent(period)}`);
            } catch (err) {
                console.warn('Falling back to simulated history:', err.message);
                const quote = simulateQuote(ticker);
                return simulateHistory(quote.price, PERIOD_DAYS[period] || 90);
            }
        },

        async getFinancials(ticker) {
            try {
                return await getJson(`/financials/${encodeURIComponent(ticker)}`);
            } catch (err) {
                console.warn('Falling back - no financial statement data available:', err.message);
                return { income: [], balance: [], cash: [], source: 'unavailable' };
            }
        },

        async getNews(ticker) {
            try {
                return await getJson(`/news/${encodeURIComponent(ticker)}`);
            } catch (err) {
                console.warn('News unavailable:', err.message);
                return [];
            }
        },

        async askAi(ticker, question) {
            try {
                const res = await postJson('/ai/query', { ticker, question });
                return res.answer;
            } catch (err) {
                return `AI analyst unavailable right now (${err.message}). Please try again shortly.`;
            }
        },
    };
})();
