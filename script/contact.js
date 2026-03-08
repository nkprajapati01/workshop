import { initSidebarMenu, createIcons } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
    initSidebarMenu();
    createIcons();

    const contactForm = document.getElementById('contactForm');
    if (!contactForm) return;

    contactForm.addEventListener('submit', (event) => {
        event.preventDefault();

        const existingStatus = document.getElementById('contactFormStatus');
        const statusEl = existingStatus || document.createElement('p');
        statusEl.id = 'contactFormStatus';
        statusEl.className = 'form-status success';
        statusEl.textContent = 'Message captured (demo mode). Connect this form to a backend webhook for production.';

        if (!existingStatus) {
            contactForm.appendChild(statusEl);
        }

        contactForm.reset();
    });
});
