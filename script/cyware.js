import { initSidebarMenu, createIcons } from './utils.js';
import { loadConfig as loadSharedConfig } from './configLoader.js';
import { buildWebhookRequest } from './session-context.js';
import { getPageCache, setPageCache } from './cache-store.js';

const CACHE_KEY = 'cyware-chat';
const MAX_HISTORY = 200;

const CYBER_QUOTES = [
    '"Cybersecurity is much more than a matter of IT."',
    '"Security is a process, not a product."',
    '"In cybersecurity, every second of visibility matters."',
    '"Trust is good. Verification is better."'
];

const ESSENTIAL_MESSAGES = [
    'Enable MFA on every external account.',
    'Patch critical vulnerabilities within 24 hours.',
    'Never run unknown scripts without sandbox validation.',
    'Back up logs and evidence before remediation.',
    'Treat unusual outbound traffic as a priority signal.',
    'Rotate secrets immediately after any incident.'
];

async function loadConfig() {
    return loadSharedConfig();
}

document.addEventListener('DOMContentLoaded', async () => {
    initSidebarMenu();

    let config = {};
    try {
        config = await loadConfig();
    } catch (error) {
        console.error('Unable to load config/config.json for Cyware:', error);
    }

    const webhookUrl = config.CYWARE_WEBHOOK_URL;
    if (!webhookUrl) {
        console.error('Missing CYWARE_WEBHOOK_URL in config/config.json');
        return;
    }

    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const chatHistoryEl = document.getElementById('chatHistory');
    const webhookUrlHint = document.getElementById('cyWebhookUrl');
    const quoteEl = document.getElementById('cyQuote');
    const essentialEl = document.getElementById('cyEssentialMessage');

    if (!chatForm || !chatInput || !sendBtn || !chatHistoryEl) return;

    if (webhookUrlHint) webhookUrlHint.textContent = webhookUrl;
    if (quoteEl) quoteEl.textContent = pickRandom(CYBER_QUOTES);
    if (essentialEl) essentialEl.textContent = pickRandom(ESSENTIAL_MESSAGES);

    const cached = getPageCache(CACHE_KEY);
    let history = Array.isArray(cached?.history) ? cached.history : [];
    history = sanitizeHistory(history);
    renderHistory(chatHistoryEl, history);

    chatForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const query = chatInput.value.trim();
        if (!query) return;

        const userEntry = { role: 'user', content: query };
        history.push(userEntry);
        history = trimHistory(history);
        persistHistory(history);
        renderHistory(chatHistoryEl, history);
        chatInput.value = '';

        const placeholder = { role: 'assistant', content: 'Analyzing your request...' };
        history.push(placeholder);
        history = trimHistory(history);
        renderHistory(chatHistoryEl, history);

        setBusy(true, sendBtn);

        try {
            const request = buildWebhookRequest(
                webhookUrl,
                {
                    query,
                    message: query,
                    input: query,
                    history: history
                        .filter((item) => item !== placeholder)
                        .map((item) => ({ role: item.role, content: item.content }))
                },
                { method: 'POST' }
            );

            const response = await fetch(request.url, request.options);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const parsed = await parseWebhookResponse(response);
            const assistantText = extractResponseText(parsed) || 'No response returned by webhook.';
            placeholder.content = assistantText;
        } catch (error) {
            placeholder.content = `Request failed: ${error.message}. Ensure your webhook is running at ${webhookUrl}.`;
        } finally {
            history = trimHistory(history);
            persistHistory(history);
            renderHistory(chatHistoryEl, history);
            setBusy(false, sendBtn);
        }
    });

    createIcons();
});

function pickRandom(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function sanitizeHistory(history) {
    return history
        .filter((item) =>
            item &&
            (item.role === 'user' || item.role === 'assistant') &&
            typeof item.content === 'string'
        )
        .slice(-MAX_HISTORY);
}

function trimHistory(history) {
    return history.slice(-MAX_HISTORY);
}

function persistHistory(history) {
    setPageCache(CACHE_KEY, { history: trimHistory(history) });
}

function setBusy(isBusy, button) {
    button.disabled = isBusy;
    button.innerHTML = isBusy
        ? '<i data-lucide="loader-2" class="spin"></i><span>Sending</span>'
        : '<i data-lucide="send"></i><span>Send Chat</span>';
    createIcons();
}

function renderHistory(container, history) {
    if (!history.length) {
        container.innerHTML = '<div class="cy-empty">No previous chats in this session. Start by sending your first prompt.</div>';
        return;
    }

    container.innerHTML = history.map((item) => {
        const safeRole = item.role === 'assistant' ? 'assistant' : 'user';
        const label = safeRole === 'assistant' ? 'Cyware AI' : 'You';
        return `
            <article class="cy-message ${safeRole}">
                <div class="cy-message-label">${label}</div>
                <div class="cy-msg-content">${renderMessageContent(item.content, safeRole)}</div>
            </article>
        `;
    }).join('');

    container.scrollTop = container.scrollHeight;
}

function renderMessageContent(content, role) {
    if (role !== 'assistant') {
        return formatInlineMarkdown(content).replace(/\n/g, '<br>');
    }

    const lines = String(content || '').split(/\r?\n/);
    const listItemPattern = /^(\s*)([-*]|\d+[.)])\s+(.*)$/;
    const parts = [];
    const listStack = [];
    let paragraphBuffer = [];

    function flushParagraph() {
        if (!paragraphBuffer.length) return;
        const text = paragraphBuffer.join(' ').trim();
        if (text) {
            const headingMatch = text.match(/^#{1,6}\s+(.+)$/);
            if (headingMatch) {
                parts.push(`<p class="cy-md-heading">${formatInlineMarkdown(headingMatch[1].trim())}</p>`);
            } else if (/^[A-Za-z][\w\s/-]{2,60}:$/.test(text)) {
                parts.push(`<p class="cy-line-title">${formatInlineMarkdown(text)}</p>`);
            } else {
                parts.push(`<p>${formatInlineMarkdown(text)}</p>`);
            }
        }
        paragraphBuffer = [];
    }

    function closeListsToLevel(targetLevel) {
        while (listStack.length > targetLevel) {
            parts.push(`</li></${listStack.pop()}>`);
        }
    }

    function openList(tagName) {
        parts.push(`<${tagName}><li>`);
        listStack.push(tagName);
    }

    function moveToLevel(level, tagName) {
        if (listStack.length === 0) {
            openList(tagName);
            return;
        }

        if (level > listStack.length - 1) {
            openList(tagName);
            return;
        }

        closeListsToLevel(level + 1);
        const currentTag = listStack[listStack.length - 1];
        if (currentTag !== tagName) {
            parts.push(`</li></${listStack.pop()}>`);
            openList(tagName);
        } else {
            parts.push('</li><li>');
        }
    }

    lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
            flushParagraph();
            closeListsToLevel(0);
            return;
        }

        const match = line.match(listItemPattern);
        if (match) {
            flushParagraph();
            const spaces = match[1].length;
            const level = Math.floor(spaces / 2);
            const marker = match[2];
            const tagName = /\d/.test(marker) ? 'ol' : 'ul';
            moveToLevel(level, tagName);
            parts.push(formatInlineMarkdown(match[3].trim()));
            return;
        }

        closeListsToLevel(0);
        paragraphBuffer.push(trimmed);
    });

    flushParagraph();
    closeListsToLevel(0);
    if (listStack.length) {
        closeListsToLevel(0);
    }

    return parts.join('');
}

function formatInlineMarkdown(input) {
    const text = String(input || '');
    // Escape first, then selectively render safe inline markdown.
    let out = escapeHtml(text);
    out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Remove leftover markdown symbols that reduce readability.
    out = out
        .replace(/(^|\s)#{1,6}(?=\s)/g, '$1')
        .replace(/(^|\s)>\s/g, '$1')
        .replace(/\*{1,3}(?=\s|$)/g, '');

    return out;
}

async function parseWebhookResponse(response) {
    const raw = await response.text();
    const body = raw.trim();
    if (!body) return null;

    try {
        return JSON.parse(body);
    } catch {
        return body;
    }
}

function extractResponseText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);

    if (Array.isArray(value)) {
        for (const item of value) {
            const candidate = extractResponseText(item);
            if (candidate) return candidate;
        }
        return JSON.stringify(value, null, 2);
    }

    if (typeof value === 'object') {
        const preferredKeys = ['answer', 'response', 'output', 'result', 'message', 'text', 'content'];
        for (const key of preferredKeys) {
            if (key in value) {
                const candidate = extractResponseText(value[key]);
                if (candidate) return candidate;
            }
        }
        if ('data' in value) {
            const dataText = extractResponseText(value.data);
            if (dataText) return dataText;
        }
        return JSON.stringify(value, null, 2);
    }

    return '';
}

function escapeHtml(input) {
    return String(input)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
