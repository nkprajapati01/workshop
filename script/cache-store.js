const CACHE_PREFIX = 'ids_page_cache:';

function isReloadNavigation() {
    const navEntry = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (navEntry && navEntry.type) return navEntry.type === 'reload';

    // Legacy fallback
    if (performance.navigation && typeof performance.navigation.type === 'number') {
        return performance.navigation.type === 1;
    }

    return false;
}

export function clearCachesOnReload() {
    if (!isReloadNavigation()) return;

    const keys = Object.keys(sessionStorage).filter((key) => key.startsWith(CACHE_PREFIX));
    keys.forEach((key) => sessionStorage.removeItem(key));
}

export function getPageCache(pageKey) {
    try {
        const raw = sessionStorage.getItem(`${CACHE_PREFIX}${pageKey}`);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export function setPageCache(pageKey, value) {
    try {
        sessionStorage.setItem(`${CACHE_PREFIX}${pageKey}`, JSON.stringify(value));
    } catch {
        // Ignore quota/storage errors
    }
}

export function clearPageCache(pageKey) {
    try {
        sessionStorage.removeItem(`${CACHE_PREFIX}${pageKey}`);
    } catch {
        // Ignore storage errors
    }
}
