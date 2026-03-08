const SESSION_STORAGE_KEY = 'ids_dashboard_session_id';

function generateSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }

    const rand = Math.random().toString(36).slice(2, 10);
    return `sess_${Date.now()}_${rand}`;
}

export function getSessionId() {
    try {
        let sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (!sessionId) {
            sessionId = generateSessionId();
            sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
        }
        return sessionId;
    } catch {
        return generateSessionId();
    }
}

function generateRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function appendTrackingParams(url, sessionId, requestId) {
    try {
        const parsed = new URL(url, window.location.origin);
        parsed.searchParams.set('session_id', sessionId);
        parsed.searchParams.set('request_id', requestId);
        return parsed.toString();
    } catch {
        return url;
    }
}

function attachMetaToPayload(payload, meta) {
    if (payload === undefined) {
        return { _ids_meta: meta };
    }

    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const existingMeta = payload._ids_meta && typeof payload._ids_meta === 'object' ? payload._ids_meta : {};
        return {
            ...payload,
            _ids_meta: {
                ...existingMeta,
                ...meta
            }
        };
    }

    return payload;
}

export function buildWebhookRequest(url, payload, init = {}) {
    const sessionId = getSessionId();
    const requestId = generateRequestId();
    const meta = {
        session_id: sessionId,
        request_id: requestId,
        sent_at: new Date().toISOString()
    };

    const headers = new Headers(init.headers || {});
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    headers.set('X-IDS-Session-ID', sessionId);
    headers.set('X-IDS-Request-ID', requestId);
    headers.set('X-IDS-Client', 'webhook-interface');

    const bodyPayload = attachMetaToPayload(payload, meta);

    return {
        url: appendTrackingParams(url, sessionId, requestId),
        options: {
            ...init,
            headers,
            body: JSON.stringify(bodyPayload)
        },
        meta
    };
}
