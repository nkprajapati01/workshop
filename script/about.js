import { initSidebarMenu, createIcons } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
    initSidebarMenu();
            const items = document.querySelectorAll('.reveal');
            const observer = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('in-view');
                        observer.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

            items.forEach((el) => observer.observe(el));
            createIcons();
        });
