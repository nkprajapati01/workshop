import { getSessionId } from './session-context.js';
import { clearCachesOnReload } from './cache-store.js';

// Initialize a stable browser-session identifier on first load.
clearCachesOnReload();
getSessionId();

export function initSidebarMenu() {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');

    if (!menuToggle || !sidebar || !overlay) return;

    const closeSidebarMenu = () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    };

    menuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('active');
    });

    overlay.addEventListener('click', closeSidebarMenu);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            closeSidebarMenu();
        }
    });
}

export function createIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

export function initRevealObserver(selector = '.reveal', options = { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }) {
    const items = document.querySelectorAll(selector);
    if (!items.length || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add('in-view');
                observer.unobserve(entry.target);
            }
        });
    }, options);

    items.forEach((el) => observer.observe(el));
}

