/* Technical indicator calculations. Pure functions - no DOM access -
 * so they're trivially testable in isolation if you add a test runner. */

function calcEMA(closes, period) {
    const k = 2 / (period + 1);
    const ema = [closes[0]];
    for (let i = 1; i < closes.length; i++) {
        ema.push(closes[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
}

function calcBollingerBands(closes, period = 20, stdDevMultiplier = 2) {
    const upper = [];
    const lower = [];
    const sma = [];
    for (let i = 0; i < closes.length; i++) {
        if (i < period - 1) {
            upper.push(null);
            lower.push(null);
            sma.push(null);
            continue;
        }
        const slice = closes.slice(i - (period - 1), i + 1);
        const mean = slice.reduce((a, b) => a + b, 0) / period;
        const variance = slice.reduce((sq, n) => sq + (n - mean) ** 2, 0) / period;
        const sd = Math.sqrt(variance);
        sma.push(mean);
        upper.push(mean + sd * stdDevMultiplier);
        lower.push(mean - sd * stdDevMultiplier);
    }
    return { upper, lower, sma };
}

function calcRSI(closes, period = 14) {
    const rsi = [50];
    let gains = 0;
    let losses = 0;
    for (let i = 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        if (i <= period) {
            gains += gain;
            losses += loss;
            rsi.push(50);
        } else {
            gains = (gains * (period - 1) + gain) / period;
            losses = (losses * (period - 1) + loss) / period;
            const rs = losses === 0 ? 100 : gains / losses;
            rsi.push(100 - 100 / (1 + rs));
        }
    }
    return rsi;
}

function calcMACD(closes) {
    const ema12 = calcEMA(closes, 12);
    const ema26 = calcEMA(closes, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = calcEMA(macdLine, 9);
    const histogram = macdLine.map((v, i) => v - signalLine[i]);
    return { macdLine, signalLine, histogram };
}

function calcVWAP(series) {
    let cumVol = 0;
    let cumTPV = 0;
    return series.map((d) => {
        const typicalPrice = (d.high + d.low + d.close) / 3;
        cumTPV += typicalPrice * d.volume;
        cumVol += d.volume;
        return cumVol === 0 ? d.close : cumTPV / cumVol;
    });
}

function computeAllIndicators(series) {
    const closes = series.map((d) => d.close);
    const bb = calcBollingerBands(closes);
    const macd = calcMACD(closes);
    return {
        ema20: calcEMA(closes, 20),
        ema50: calcEMA(closes, 50),
        bbUpper: bb.upper,
        bbLower: bb.lower,
        rsi: calcRSI(closes),
        macdLine: macd.macdLine,
        macdHist: macd.histogram,
        vwap: calcVWAP(series),
    };
}
