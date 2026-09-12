/* Shared helpers. Kept dependency-free on purpose. */

/**
 * Escape a string for safe insertion into innerHTML.
 * Every value that ultimately traces back to user input (the ticker
 * search box, the AI chat box, etc.) MUST go through this before being
 * placed in innerHTML - the original prototype skipped this step and
 * was vulnerable to stored/DOM-based XSS.
 */
function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

/** Only allow characters that make sense in a ticker symbol. */
function sanitizeTickerInput(raw) {
    return String(raw ?? '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9.\-]/g, '')
        .slice(0, 12);
}

function debounce(fn, waitMs) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), waitMs);
    };
}

function formatCurrency(value, decimals = 2) {
    const num = Number(value);
    if (Number.isNaN(num)) return 'n/a';
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function formatSignedPct(value) {
    const num = Number(value);
    if (Number.isNaN(num)) return 'n/a';
    return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
}

/** Small non-blocking toast for surfacing errors instead of failing silently. */
function showToast(message, variant = 'error') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'fixed bottom-4 right-4 z-[100] space-y-2';
        document.body.appendChild(container);
    }
    const colors = {
        error: 'bg-rose-950/90 border-rose-700 text-rose-200',
        info: 'bg-slate-900/90 border-slate-700 text-slate-200',
        success: 'bg-emerald-950/90 border-emerald-700 text-emerald-200',
    };
    const toast = document.createElement('div');
    toast.className = `border rounded-lg px-4 py-2 text-xs font-mono shadow-lg ${colors[variant] || colors.info}`;
    toast.textContent = message; // textContent only - never innerHTML for dynamic text
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}
