/* Runtime configuration.
 * Frontend is served by the same FastAPI process by default, so a
 * relative "/api" base works both locally and once deployed.
 * If you ever split frontend/backend into separate hosts, change this
 * to the backend's absolute URL (e.g. "https://api.your-domain.com/api").
 */
window.TERMINALX_CONFIG = {
    API_BASE: '/api',
    QUOTE_POLL_MS: 15000,
    CLOCK_TICK_MS: 1000,
};
