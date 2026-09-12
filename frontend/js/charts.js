/* Plotly chart rendering. Depends on Plotly (CDN) and indicators.js. */

const TerminalXCharts = (() => {
    function renderCandlestickChart(containerId, series, opts) {
        const { showEMA, showVWAP, showBB, showRSI, showMACD } = opts;
        if (!series || series.length === 0) {
            document.getElementById(containerId).innerHTML =
                '<div class="flex items-center justify-center h-full text-terminal-muted text-sm">No chart data available.</div>';
            return;
        }

        const indicators = computeAllIndicators(series);
        const dates = series.map((d) => d.date);

        const traces = [
            {
                type: 'candlestick',
                x: dates,
                open: series.map((d) => d.open),
                high: series.map((d) => d.high),
                low: series.map((d) => d.low),
                close: series.map((d) => d.close),
                name: 'Price',
                increasing: { line: { color: '#10b981' } },
                decreasing: { line: { color: '#f43f5e' } },
                xaxis: 'x',
                yaxis: 'y',
            },
            {
                type: 'bar',
                x: dates,
                y: series.map((d) => d.volume),
                name: 'Volume',
                marker: { color: 'rgba(100, 116, 139, 0.3)' },
                xaxis: 'x',
                yaxis: 'y2',
            },
        ];

        if (showEMA) {
            traces.push({ x: dates, y: indicators.ema20, mode: 'lines', name: 'EMA 20', line: { color: '#3b82f6', width: 1.2 } });
            traces.push({ x: dates, y: indicators.ema50, mode: 'lines', name: 'EMA 50', line: { color: '#f59e0b', width: 1.2 } });
        }
        if (showVWAP) {
            traces.push({ x: dates, y: indicators.vwap, mode: 'lines', name: 'VWAP', line: { color: '#10b981', width: 1.5, dash: 'dash' } });
        }
        if (showBB) {
            traces.push({ x: dates, y: indicators.bbUpper, mode: 'lines', name: 'BB Upper', line: { color: 'rgba(255,255,255,0.25)', dash: 'dot' } });
            traces.push({ x: dates, y: indicators.bbLower, mode: 'lines', name: 'BB Lower', line: { color: 'rgba(255,255,255,0.25)', dash: 'dot' } });
        }
        if (showRSI) {
            traces.push({ x: dates, y: indicators.rsi, mode: 'lines', name: 'RSI (14)', line: { color: '#a855f7', width: 1.5 }, xaxis: 'x', yaxis: 'y3' });
        }
        if (showMACD) {
            traces.push({ x: dates, y: indicators.macdLine, mode: 'lines', name: 'MACD', line: { color: '#06b6d4', width: 1.2 }, xaxis: 'x', yaxis: 'y4' });
            traces.push({ x: dates, y: indicators.macdHist, type: 'bar', name: 'MACD Hist', marker: { color: '#6366f1' }, xaxis: 'x', yaxis: 'y4' });
        }

        const layout = {
            grid: { rows: 3, columns: 1, pattern: 'independent', roworder: 'top to bottom' },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            showlegend: false,
            margin: { l: 40, r: 40, t: 20, b: 30 },
            xaxis: { rangeslider: { visible: false }, color: '#64748b', gridcolor: '#1e293b' },
            yaxis: { title: 'Price ($)', domain: [0.35, 1], color: '#64748b', gridcolor: '#1e293b' },
            yaxis2: { title: 'Vol', domain: [0.25, 0.33], showticklabels: false, gridcolor: '#1e293b' },
            yaxis3: { title: 'RSI', domain: [0.12, 0.22], range: [0, 100], color: '#a855f7', gridcolor: '#1e293b' },
            yaxis4: { title: 'MACD', domain: [0.0, 0.1], color: '#06b6d4', gridcolor: '#1e293b' },
        };

        Plotly.newPlot(containerId, traces, layout, { responsive: true, displayModeBar: false });
    }

    function renderPeerComparisonChart(containerId, mainTicker, mainSeries, peerSeriesByTicker) {
        const colors = ['#10b981', '#f59e0b', '#a855f7', '#06b6d4', '#f43f5e'];
        const traces = [];

        if (mainSeries && mainSeries.length) {
            const base = mainSeries[0].close;
            traces.push({
                x: mainSeries.map((d) => d.date),
                y: mainSeries.map((d) => ((d.close - base) / base) * 100),
                mode: 'lines',
                name: mainTicker,
                line: { color: '#2563eb', width: 3 },
            });
        }

        Object.entries(peerSeriesByTicker).forEach(([ticker, series], idx) => {
            if (!series || !series.length) return;
            const base = series[0].close;
            traces.push({
                x: series.map((d) => d.date),
                y: series.map((d) => ((d.close - base) / base) * 100),
                mode: 'lines',
                name: ticker,
                line: { color: colors[idx % colors.length], width: 1.5, dash: 'dot' },
            });
        });

        const layout = {
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            margin: { l: 40, r: 20, t: 20, b: 40 },
            xaxis: { color: '#64748b', gridcolor: '#1e293b' },
            yaxis: { title: 'Normalized Return (%)', color: '#64748b', gridcolor: '#1e293b' },
            legend: { font: { color: '#d1d5db' }, orientation: 'h', y: 1.1 },
        };

        Plotly.newPlot(containerId, traces, layout, { responsive: true, displayModeBar: false });
    }

    function renderTargetGauge(containerId, quote) {
        const { price: current, targetLow: low, targetMean: mean, targetHigh: high } = quote;
        const trace = {
            type: 'indicator',
            mode: 'gauge+number',
            value: current,
            title: { text: 'Current vs Analyst Targets ($)', font: { size: 12, color: '#94a3b8' } },
            gauge: {
                axis: { range: [low * 0.85, high * 1.15], tickcolor: '#64748b' },
                bar: { color: '#2563eb' },
                bgcolor: '#0f172a',
                borderwidth: 1,
                bordercolor: '#1e293b',
                steps: [
                    { range: [low, mean], color: '#1e293b' },
                    { range: [mean, high], color: '#334155' },
                ],
                threshold: { line: { color: '#10b981', width: 4 }, thickness: 0.75, value: mean },
            },
        };
        const layout = {
            paper_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#ffffff', family: 'JetBrains Mono' },
            margin: { l: 30, r: 30, t: 30, b: 10 },
        };
        Plotly.newPlot(containerId, [trace], layout, { responsive: true, displayModeBar: false });
    }

    return { renderCandlestickChart, renderPeerComparisonChart, renderTargetGauge };
})();
