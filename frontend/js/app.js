/* TerminalX Pro - main application controller.
 * Depends on: config.js, utils.js, indicators.js, charts.js, api.js
 */

const AppState = {
    currentTicker: 'NVDA',
    currentTimeframe: '3M',
    currentSeries: [],
    currentQuote: null,
    activeTab: 'tab1',
};

const TF_TO_PERIOD = { '1D': '1d', '1M': '1mo', '3M': '3mo', '1Y': '1y', '5Y': '5y' };

// --------------------------------------------------------------------
// Banner / quote rendering
// --------------------------------------------------------------------
function renderQuoteBanner(quote) {
    document.getElementById('assetName').textContent = quote.name;
    document.getElementById('assetSymbol').textContent = quote.ticker;
    document.getElementById('assetExchange').textContent = quote.exchange;
    document.getElementById('assetSector').textContent = quote.sector;
    document.getElementById('livePrice').textContent = formatCurrency(quote.price);

    const changeElem = document.getElementById('liveChange');
    const isPos = quote.change >= 0;
    changeElem.textContent = `${isPos ? '+' : ''}${formatCurrency(quote.change)} (${formatSignedPct(quote.changePct)})`;
    changeElem.className = `font-mono-num text-sm font-semibold flex items-center gap-1 ${isPos ? 'text-emerald-400' : 'text-rose-400'}`;

    document.getElementById('mktCap').textContent = quote.marketCap;
    document.getElementById('peRatio').textContent = quote.pe;
    document.getElementById('range52').textContent = quote.range52;
    document.getElementById('betaValue').textContent = quote.beta;
    document.getElementById('aiActiveTicker').textContent = quote.ticker;

    if (quote.source && quote.source !== 'yfinance') {
        showToast(`Showing ${quote.source} data for ${quote.ticker} (live feed unavailable for this symbol).`, 'info');
    }
}

// --------------------------------------------------------------------
// Financial statements table
// --------------------------------------------------------------------
function renderFinancialStatements(financials, type = 'income') {
    const tbody = document.getElementById('statementTableBody');
    tbody.innerHTML = '';
    const rows = (financials && financials[type]) || [];

    if (rows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 5;
        td.className = 'p-4 text-center text-terminal-muted';
        td.textContent = 'No statement data available for this symbol.';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-terminal-border/30 transition-colors';

        const cell = (text, extraClass) => {
            const td = document.createElement('td');
            td.className = extraClass;
            td.textContent = text;
            return td;
        };

        tr.appendChild(cell(row.name, 'p-3 font-semibold text-slate-100'));
        tr.appendChild(cell(row.y1 != null ? `$${row.y1.toLocaleString()}` : '-', 'p-3 text-right font-mono-num text-slate-300'));
        tr.appendChild(cell(row.y2 != null ? `$${row.y2.toLocaleString()}` : '-', 'p-3 text-right font-mono-num text-slate-300'));
        tr.appendChild(cell(row.y3 != null ? `$${row.y3.toLocaleString()}` : '-', 'p-3 text-right font-mono-num text-blue-400 font-bold'));
        tr.appendChild(cell(row.yoy || 'n/a', 'p-3 text-right font-mono-num text-emerald-400 font-semibold'));
        tbody.appendChild(tr);
    });
}

function exportStatementCSV(financials, ticker) {
    const rows = (financials && financials.income) || [];
    if (rows.length === 0) {
        showToast('No financial data to export for this symbol.', 'error');
        return;
    }
    let csv = 'Metric,Period1,Period2,Period3,YoY_Growth\n';
    rows.forEach((r) => {
        const safe = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        csv += `${safe(r.name)},${safe(r.y1)},${safe(r.y2)},${safe(r.y3)},${safe(r.yoy)}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `${ticker}_Financials_TerminalX.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}

// --------------------------------------------------------------------
// News stream (all values escaped or set via textContent - never raw innerHTML)
// --------------------------------------------------------------------
function renderNewsStream(items) {
    const container = document.getElementById('newsStreamList');
    container.innerHTML = '';

    if (!items || items.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'text-terminal-muted text-sm text-center py-4';
        empty.textContent = 'No news available right now.';
        container.appendChild(empty);
        return;
    }

    items.forEach((item) => {
        const wrap = document.createElement('div');
        wrap.className = 'pt-3 first:pt-0 flex items-start justify-between gap-4';

        const left = document.createElement('div');
        left.className = 'space-y-1';

        const link = document.createElement('a');
        link.href = /^https?:\/\//.test(item.url) ? item.url : '#';
        link.className = 'text-xs font-semibold text-slate-200 hover:text-terminal-accent transition-colors block leading-snug';
        link.textContent = item.title;
        if (link.href !== '#') {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }

        const meta = document.createElement('div');
        meta.className = 'flex items-center gap-2 text-[11px] text-terminal-muted font-mono';
        meta.textContent = `${item.source} • ${item.time}`;

        left.appendChild(link);
        left.appendChild(meta);

        const badge = document.createElement('span');
        const badgeColor = item.sentiment === 'Bullish'
            ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/50'
            : 'bg-slate-800 text-slate-300 border-slate-700';
        badge.className = `text-[10px] font-mono px-2 py-0.5 rounded border ${badgeColor} shrink-0`;
        badge.textContent = item.sentiment;

        wrap.appendChild(left);
        wrap.appendChild(badge);
        container.appendChild(wrap);
    });
}

// --------------------------------------------------------------------
// AI chat (escaped output - the original build inserted raw user text
// and raw model text via innerHTML, which is a stored XSS vector)
// --------------------------------------------------------------------
function appendChatBubble({ role, text }) {
    const consoleDiv = document.getElementById('aiChatConsole');
    const wrap = document.createElement('div');
    wrap.className = role === 'user' ? 'flex gap-2 justify-end' : 'flex gap-2';

    if (role === 'ai') {
        const avatar = document.createElement('div');
        avatar.className = 'w-6 h-6 rounded bg-purple-900/50 border border-purple-500/30 flex items-center justify-center text-purple-300 font-bold shrink-0';
        avatar.textContent = 'AI';
        wrap.appendChild(avatar);
    }

    const bubble = document.createElement('div');
    bubble.className = role === 'user'
        ? 'p-3 rounded-lg bg-terminal-accent/20 border border-blue-500/30 text-slate-100 max-w-xl leading-relaxed whitespace-pre-line'
        : 'p-3 rounded-lg bg-terminal-card border border-terminal-border text-slate-200 max-w-2xl leading-relaxed whitespace-pre-line';
    bubble.textContent = text; // textContent -> immune to injected HTML/script

    wrap.appendChild(bubble);
    consoleDiv.appendChild(wrap);
    consoleDiv.scrollTop = consoleDiv.scrollHeight;
}

async function handleAiQuery() {
    const input = document.getElementById('aiInputQuery');
    const query = input.value.trim();
    if (!query) return;
    if (query.length > 500) {
        showToast('Question is too long (max 500 characters).', 'error');
        return;
    }

    appendChatBubble({ role: 'user', text: query });
    input.value = '';
    input.disabled = true;

    const answer = await TerminalXApi.askAi(AppState.currentTicker, query);
    appendChatBubble({ role: 'ai', text: answer });
    input.disabled = false;
    input.focus();
}

// --------------------------------------------------------------------
// Chart-dependent tab renderers
// --------------------------------------------------------------------
function currentIndicatorToggles() {
    return {
        showEMA: document.getElementById('chkEMA').checked,
        showVWAP: document.getElementById('chkVWAP').checked,
        showBB: document.getElementById('chkBB').checked,
        showRSI: document.getElementById('chkRSI').checked,
        showMACD: document.getElementById('chkMACD').checked,
    };
}

async function refreshMainChart() {
    const period = TF_TO_PERIOD[AppState.currentTimeframe] || '3mo';
    const series = await TerminalXApi.getHistory(AppState.currentTicker, period);
    AppState.currentSeries = series;
    TerminalXCharts.renderCandlestickChart('plotlyChart', series, currentIndicatorToggles());
}

async function refreshPeerComparison() {
    const rawInput = document.getElementById('peerInput').value;
    const peers = rawInput
        .split(',')
        .map((s) => sanitizeTickerInput(s))
        .filter(Boolean)
        .slice(0, 6);
    const effectivePeers = peers.length ? peers : ['AAPL', 'MSFT', 'SPY', 'QQQ'];

    const mainSeries = AppState.currentSeries.length
        ? AppState.currentSeries
        : await TerminalXApi.getHistory(AppState.currentTicker, '3mo');

    const peerSeriesEntries = await Promise.all(
        effectivePeers.map(async (p) => [p, await TerminalXApi.getHistory(p, '3mo')]),
    );
    const peerSeriesByTicker = Object.fromEntries(peerSeriesEntries);

    TerminalXCharts.renderPeerComparisonChart('plotlyPeerChart', AppState.currentTicker, mainSeries, peerSeriesByTicker);
}

async function refreshTargetGauge(quote) {
    document.getElementById('targetLow').textContent = formatCurrency(quote.targetLow);
    document.getElementById('targetMean').textContent = formatCurrency(quote.targetMean);
    document.getElementById('targetHigh').textContent = formatCurrency(quote.targetHigh);
    TerminalXCharts.renderTargetGauge('plotlyGaugeChart', quote);
}

let currentFinancials = null;
let currentStatementType = 'income';

async function refreshFinancials() {
    currentFinancials = await TerminalXApi.getFinancials(AppState.currentTicker);
    renderFinancialStatements(currentFinancials, currentStatementType);
}

async function refreshNews() {
    const items = await TerminalXApi.getNews(AppState.currentTicker);
    renderNewsStream(items);
}

// --------------------------------------------------------------------
// Ticker switching / timeframe / statement type / tabs
// --------------------------------------------------------------------
async function switchTicker(rawSymbol) {
    const symbol = sanitizeTickerInput(rawSymbol);
    if (!symbol) {
        showToast('Please enter a valid ticker symbol.', 'error');
        return;
    }
    AppState.currentTicker = symbol;

    let quote;
    try {
        quote = await TerminalXApi.getQuote(symbol);
    } catch (err) {
        showToast(`Could not load data for ${symbol}.`, 'error');
        return;
    }
    AppState.currentQuote = quote;
    renderQuoteBanner(quote);

    await Promise.all([
        refreshMainChart(),
        refreshPeerComparison(),
        refreshTargetGauge(quote),
        refreshFinancials(),
        refreshNews(),
    ]);
}

function setTimeframe(tf, buttonEl) {
    AppState.currentTimeframe = tf;
    document.querySelectorAll('.tf-btn').forEach((btn) => {
        btn.className = 'tf-btn px-2.5 py-1 rounded bg-terminal-border text-white hover:bg-slate-700 transition-colors';
    });
    if (buttonEl) {
        buttonEl.className = 'tf-btn px-2.5 py-1 rounded bg-terminal-accent text-white font-semibold';
    }
    refreshMainChart();
}

function updateChartIndicators() {
    if (AppState.currentSeries.length) {
        TerminalXCharts.renderCandlestickChart('plotlyChart', AppState.currentSeries, currentIndicatorToggles());
    }
}

function updatePeerComparison() {
    refreshPeerComparison();
}

function switchStatement(type) {
    currentStatementType = type;
    ['stmtIncomeBtn', 'stmtBalanceBtn', 'stmtCashBtn'].forEach((id) => {
        document.getElementById(id).className = 'px-3 py-1.5 rounded text-xs font-semibold bg-terminal-border text-slate-300 hover:bg-slate-700';
    });
    const activeIdMap = { income: 'stmtIncomeBtn', balance: 'stmtBalanceBtn', cash: 'stmtCashBtn' };
    document.getElementById(activeIdMap[type]).className = 'px-3 py-1.5 rounded text-xs font-semibold bg-terminal-accent text-white';
    renderFinancialStatements(currentFinancials, type);
}

function setActiveTab(tabId) {
    AppState.activeTab = tabId;
    document.querySelectorAll('.tab-content').forEach((el) => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.classList.remove('tab-active');
        btn.classList.add('text-terminal-muted');
    });

    document.getElementById(tabId).classList.remove('hidden');
    document.getElementById(`${tabId}-btn`).classList.add('tab-active');
    document.getElementById(`${tabId}-btn`).classList.remove('text-terminal-muted');

    window.dispatchEvent(new Event('resize'));
}

// --------------------------------------------------------------------
// Wiring + lifecycle
// --------------------------------------------------------------------
function initEventListeners() {
    const searchInput = document.getElementById('tickerSearchInput');
    const searchBtn = document.getElementById('searchBtn');

    const runSearch = () => {
        const value = searchInput.value.trim();
        if (value) switchTicker(value);
    };

    searchBtn.addEventListener('click', runSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') runSearch();
    });

    document.getElementById('aiInputQuery').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleAiQuery();
    });

    document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
        exportStatementCSV(currentFinancials, AppState.currentTicker);
    });
}

function startClock() {
    const tick = () => {
        document.getElementById('utcClock').textContent = `UTC ${new Date().toISOString().substr(11, 8)}`;
    };
    tick();
    setInterval(tick, window.TERMINALX_CONFIG.CLOCK_TICK_MS);
}

function startQuotePolling() {
    setInterval(async () => {
        try {
            const quote = await TerminalXApi.getQuote(AppState.currentTicker);
            AppState.currentQuote = quote;
            const priceElem = document.getElementById('livePrice');
            const prev = parseFloat(priceElem.textContent.replace(/[^0-9.-]/g, ''));
            priceElem.textContent = formatCurrency(quote.price);
            priceElem.classList.remove('text-emerald-400', 'text-rose-400');
            if (!Number.isNaN(prev)) {
                priceElem.classList.add(quote.price >= prev ? 'text-emerald-400' : 'text-rose-400');
                setTimeout(() => priceElem.classList.remove('text-emerald-400', 'text-rose-400'), 400);
            }
        } catch {
            // Silent - polling failures shouldn't spam the user with toasts.
        }
    }, window.TERMINALX_CONFIG.QUOTE_POLL_MS);
}

window.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    startClock();
    startQuotePolling();
    switchTicker(AppState.currentTicker);
});
