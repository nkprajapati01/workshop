import { initSidebarMenu, createIcons } from './utils.js';
import { loadConfig as loadSharedConfig } from './configLoader.js';
import { buildWebhookRequest } from './session-context.js';
import { getPageCache, setPageCache, clearPageCache } from './cache-store.js';

async function loadConfig() {
    return loadSharedConfig();
}

document.addEventListener('DOMContentLoaded', async function () {
    let config;
    try {
        config = await loadConfig();
    } catch (error) {
        console.error('Unable to initialize Log File Analyzer page:', error);
        return;
    }
    const log_webhook = config.LOG_WEBHOOK_URL;
    if (!log_webhook) {
        console.error('Missing LOG_WEBHOOK_URL in config/config.json');
        return;
    }
    initSidebarMenu();
            const uploadArea = document.getElementById('uploadArea');
            const jsonFileInput = document.getElementById('jsonFileInput');
            const fileInfo = document.getElementById('fileInfo');
            const fileName = document.getElementById('fileName');
            const removeFile = document.getElementById('removeFile');
            const analyzeBtn = document.getElementById('analyzeBtn');
            const resultsCard = document.getElementById('resultsCard');
            const resultsContent = document.getElementById('resultsContent');
            let categoryStackedChart = null;
            let severityTrendChart = null;
            let timelineCategoryChart = null;
            let timelineAggregationMode = 'raw';

            let uploadedData = null;
            const cacheKey = 'log-file-analyzer';

            uploadArea.addEventListener('click', () => jsonFileInput.click());

            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.classList.add('dragover');
            });

            uploadArea.addEventListener('dragleave', () => {
                uploadArea.classList.remove('dragover');
            });

            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.classList.remove('dragover');
                const file = e.dataTransfer.files[0];
                if (file) handleFile(file);
            });

            jsonFileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) handleFile(file);
            });

            removeFile.addEventListener('click', () => {
                resetUpload();
            });

            analyzeBtn.addEventListener('click', async () => {
                if (!uploadedData) return;

                analyzeBtn.disabled = true;
                analyzeBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Analyzing...';
                createIcons();

                try {
                    const request = buildWebhookRequest(log_webhook, uploadedData, { method: 'POST' });
                    const response = await fetch(request.url, request.options);

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    const responseData = await parseWebhookResponse(response);
                    displayResults(responseData);
                    setPageCache(cacheKey, {
                        fileName: fileName.textContent || '',
                        uploadedData,
                        resultData: responseData
                    });
                } catch (error) {
                    console.error('Error sending log data to webhook:', error);
                    resultsCard.classList.remove('hidden');
                    resultsContent.innerHTML = `
                        <div class="error-message">
                            <i data-lucide="alert-triangle"></i>
                            <p><strong>Error:</strong> ${error.message}</p>
                            <p class="hint">Ensure webhook workflow is running and reachable.</p>
                        </div>
                    `;
                    createIcons();
                } finally {
                    analyzeBtn.disabled = false;
                    analyzeBtn.innerHTML = '<i data-lucide="send"></i> Send For Analysis';
                    createIcons();
                }
            });

            function handleFile(file) {
                fileName.textContent = file.name;
                uploadArea.classList.add('hidden');
                fileInfo.classList.remove('hidden');
                analyzeBtn.classList.remove('hidden');

                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        uploadedData = JSON.parse(e.target.result);
                    } catch {
                        alert('Invalid JSON file');
                        resetUpload();
                    }
                };
                reader.readAsText(file);
            }

            function resetUpload() {
                uploadedData = null;
                jsonFileInput.value = '';
                uploadArea.classList.remove('hidden');
                fileInfo.classList.add('hidden');
                analyzeBtn.classList.add('hidden');
                resultsCard.classList.add('hidden');
                if (categoryStackedChart) {
                    categoryStackedChart.destroy();
                    categoryStackedChart = null;
                }
                if (severityTrendChart) {
                    severityTrendChart.destroy();
                    severityTrendChart = null;
                }
                if (timelineCategoryChart) {
                    timelineCategoryChart.destroy();
                    timelineCategoryChart = null;
                }
                timelineAggregationMode = 'raw';
                clearPageCache(cacheKey);
            }

            function restoreFromCache() {
                const cached = getPageCache(cacheKey);
                if (!cached || typeof cached.resultData === 'undefined') return;

                uploadedData = cached.uploadedData || null;
                fileName.textContent = cached.fileName || 'Restored session data';
                uploadArea.classList.add('hidden');
                fileInfo.classList.remove('hidden');
                analyzeBtn.classList.remove('hidden');
                displayResults(cached.resultData);
            }

            function displayResults(data) {
                if (data === null) {
                    resultsContent.innerHTML = `
                        <div class="error-message">
                            <i data-lucide="info"></i>
                            <p><strong>No JSON returned.</strong> Webhook responded successfully but with an empty body.</p>
                        </div>
                    `;
                    createIcons();
                    resultsCard.scrollIntoView({ behavior: 'smooth' });
                    return;
                }

                resultsCard.classList.remove('hidden');
                const normalizedData = normalizeWebhookResponseData(data);
                const structured = normalizeWebhookAnalyzerPayload(normalizedData);
                if (structured) {
                    renderStructuredAnalyzerOutput(structured);
                    return;
                }

                const rows = extractRows(normalizedData);

                if (rows) {
                    if (isLogEventRows(rows)) {
                        const mapped = buildStructuredPayloadFromLogRows(rows);
                        renderStructuredAnalyzerOutput(mapped);
                    } else {
                        renderTable(rows);
                    }
                    return;
                }

                resultsContent.innerHTML = `<div class="json-display"><pre>${JSON.stringify(normalizedData, null, 2)}</pre></div>`;
                createIcons();
                resultsCard.scrollIntoView({ behavior: 'smooth' });
            }

            function normalizeWebhookResponseData(data) {
                if (data && typeof data === 'object' && !Array.isArray(data)) {
                    if (Array.isArray(data.output)) return data.output;
                    if (Array.isArray(data.outputs)) return data.outputs;
                    if (data.output !== undefined && data.output !== null) return data.output;
                    if (data.outputs !== undefined && data.outputs !== null) return data.outputs;
                    return data;
                }

                if (!Array.isArray(data)) return data;

                const collected = [];
                let didUnwrapOutput = false;

                data.forEach((item) => {
                    if (!item || typeof item !== 'object') {
                        collected.push(item);
                        return;
                    }

                    const output = item.output ?? item.outputs;
                    if (Array.isArray(output)) {
                        output.forEach((entry) => collected.push(entry));
                        didUnwrapOutput = true;
                        return;
                    }

                    if (output !== undefined && output !== null) {
                        collected.push(output);
                        didUnwrapOutput = true;
                        return;
                    }

                    collected.push(item);
                });

                return didUnwrapOutput ? collected : data;
            }

            function normalizeWebhookAnalyzerPayload(data) {
                // Pre-process for category propagation if data is an array
                let currentCategory = null;
                const processedData = Array.isArray(data) ? data.map(item => {
                    if (item && typeof item === 'object' && Object.keys(item).length === 1 && item.category) {
                        currentCategory = item.category;
                        return item;
                    }
                    if (currentCategory && item && typeof item === 'object' && !item.category) {
                        return { ...item, category: currentCategory };
                    }
                    return item;
                }) : data;

                const nodes = collectObjectNodes(processedData);

                const assessments = nodes.filter((item) =>
                    (typeof item.category === 'string' && (typeof item.report_markdown === 'string' || item.intelligence)) ||
                    (typeof item.risk_level === 'string' && item.risk_score !== undefined)
                );

                let summary = nodes.find((item) =>
                    item.metadata && item.category_summary && item.overall_summary
                ) || null;

                // Extract standalone logs if they exist in the payload
                const rawLogs = Array.isArray(processedData) ? processedData.filter(item => item.timestamp && item.category && item.message) : [];

                // If no formal summary exists but we have logs, auto-generate one for charts
                if (!summary && rawLogs.length > 0) {
                    const autoGenerated = buildStructuredPayloadFromLogRows(rawLogs);
                    summary = autoGenerated.summary;
                }

                if (!assessments.length && !summary && !rawLogs.length) return null;
                return { assessments, summary, rawLogs, raw: processedData };
            }

            function collectObjectNodes(root) {
                const out = [];
                const seen = new Set();

                const visit = (value, contextCategory = null) => {
                    if (value === null || value === undefined) return;

                    // If value is an object, try to inherit or set category
                    let innerCategory = contextCategory;
                    if (value && typeof value === 'object' && !Array.isArray(value) && value.category) {
                        innerCategory = value.category;
                    }

                    if (typeof value === 'string') {
                        const text = value.trim();
                        // Try to find JSON block in markdown e.g. ```json ... ```
                        const jsonMatch = text.match(/```json\s+([\s\S]+?)\s+```/);
                        if (jsonMatch) {
                            try {
                                const parsed = JSON.parse(jsonMatch[1]);
                                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                                    parsed.report_markdown = text;
                                    if (innerCategory && !parsed.category) {
                                        parsed.category = innerCategory;
                                    }
                                }
                                visit(parsed, innerCategory);
                            } catch (e) {
                                // Ignore parse error
                            }
                        } else if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
                            try {
                                visit(JSON.parse(text), innerCategory);
                            } catch {
                                return;
                            }
                        }
                        return;
                    }

                    if (Array.isArray(value)) {
                        value.forEach(v => visit(v, innerCategory));
                        return;
                    }

                    if (typeof value !== 'object') return;
                    if (seen.has(value)) return;
                    seen.add(value);

                    out.push(value);

                    // Deep search in specific common properties
                    ['json', 'data', 'items', 'results', 'body', 'payload', 'output', 'content', 'parts', 'text'].forEach(key => {
                        if (value[key]) visit(value[key], innerCategory);
                    });

                    Object.keys(value).forEach((key) => {
                        if (['json', 'data', 'items', 'results', 'body', 'payload', 'output', 'message', 'logs', 'content', 'parts', 'text'].includes(key)) return;
                        visit(value[key], innerCategory);
                    });
                };

                visit(root);
                return out;
            }

            function unwrapWebhookPayload(value) {
                let current = value;

                for (let i = 0; i < 6; i += 1) {
                    if (typeof current === 'string') {
                        const text = current.trim();
                        if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
                            try {
                                current = JSON.parse(text);
                                continue;
                            } catch {
                                return value;
                            }
                        }
                        return current;
                    }

                    if (!current || typeof current !== 'object') {
                        return current;
                    }

                    const wrappers = ['data', 'items', 'results', 'body', 'payload', 'output'];
                    const wrapperKey = wrappers.find((key) => key in current && current[key] !== undefined && current[key] !== null);
                    if (wrapperKey) {
                        current = current[wrapperKey];
                        continue;
                    }

                    if (typeof current.message === 'string') {
                        const text = current.message.trim();
                        if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
                            try {
                                current = JSON.parse(text);
                                continue;
                            } catch {
                                return current;
                            }
                        }
                    }

                    return current;
                }

                return current;
            }

            function renderStructuredAnalyzerOutput(payload) {
                const sections = [];
                const summary = payload.summary;

                if (summary) {
                    sections.push(renderSummarySection(summary));
                }

                if (payload.assessments.length) {
                    sections.push(renderAssessmentSection(payload.assessments, summary));
                }

                if (summary && summary.logs && typeof summary.logs === 'object') {
                    const clusters = detectCorrelatedEventClusters(summary.logs);
                    if (clusters.length) {
                        sections.push(renderCorrelationSection(clusters));
                    }
                }

                if (summary && summary.logs && typeof summary.logs === 'object') {
                    const bursts = detectStatisticalLogBursts(summary.logs);
                    if (bursts.length) {
                        sections.push(renderAnomalyDetectionSection(bursts));
                    }
                }

                const topPatterns = buildTopEventPatterns(summary?.logs, payload.rawLogs);
                if (topPatterns.length) {
                    sections.push(renderTopPatternsSection(topPatterns));
                }

                const eventHeatmap = buildEventIdHeatmap(summary?.logs, payload.rawLogs);
                if (eventHeatmap.length) {
                    sections.push(renderEventIdHeatmapSection(eventHeatmap));
                }

                if (summary && summary.logs && typeof summary.logs === 'object') {
                    sections.push(renderAdvancedLogExplorerSection(summary.logs));
                }

                if (payload.rawLogs && payload.rawLogs.length) {
                    // Render logs even if there is no official summary object
                    sections.push(renderLogTableHtml(payload.rawLogs, "Extracted Log Events"));
                }

                resultsContent.innerHTML = sections.join('');
                if (summary) renderCharts(summary);
                if (summary && summary.logs && typeof summary.logs === 'object') {
                    setupTimelineAggregationControls(summary.logs);
                    setupAdvancedLogExplorer(summary.logs);
                }
                createIcons();
                resultsCard.scrollIntoView({ behavior: 'smooth' });
            }

            function renderSummarySection(summary) {
                const metadata = summary.metadata || {};
                const overall = summary.overall_summary || {};
                const categorySummary = summary.category_summary || {};
                const rows = Object.entries(categorySummary);
                const kpis = buildExecutiveKpis(summary);

                return `
                    <section class="result-section">
                        <h3 class="section-title-xl">Executive Summary</h3>
                        <p class="result-meta">
                            <strong>Scan Time:</strong> ${formatTimestamp(metadata.scan_time)} |
                            <strong>User:</strong> ${escapeHtml(metadata.user ?? '-')} |
                            <strong>Admin:</strong> ${formatValue(metadata.admin_status)}
                        </p>
                        <div class="kpi-row-grid">
                            ${kpis.map((card) => `
                                <div class="summary-item">
                                    <div class="summary-label">${escapeHtml(card.label)}</div>
                                    <div class="summary-value">${escapeHtml(card.value)}</div>
                                </div>
                            `).join('')}
                        </div>
                        <div class="summary-grid">
                            ${[
                        { label: 'Total Logs', value: overall.total_logs ?? '-' },
                        { label: 'Errors', value: overall.total_errors ?? '-' },
                        { label: 'Warnings', value: overall.total_warnings ?? '-' },
                        { label: 'Information', value: overall.total_information ?? '-' }
                    ].map((card) => `
                                <div class="summary-item">
                                    <div class="summary-label">${escapeHtml(card.label)}</div>
                                    <div class="summary-value">${escapeHtml(card.value)}</div>
                                </div>
                            `).join('')}
                        </div>
                        ${renderCategoryCards(categorySummary)}
                        <div class="chart-grid">
                            <div class="chart-card chart-card-large">
                                <h4>Category Distribution (Stacked Severity)</h4>
                                <canvas id="categoryStackedChart"></canvas>
                            </div>
                            <div class="chart-card chart-card-large">
                                <h4>Severity Trend (Stacked Area)</h4>
                                <canvas id="severityTrendChart"></canvas>
                            </div>
                            <div class="chart-card chart-card-large">
                                <h4>Log Timeline by Category</h4>
                                <div class="log-filters" id="timelineAggregationControls">
                                    <button class="log-filter-btn active" data-timeline-agg="raw">Raw logs</button>
                                </div>
                                <canvas id="timelineCategoryChart"></canvas>
                            </div>
                        </div>
                        ${rows.length ? `
                            <div class="results-table-container">
                                <table class="data-table">
                                    <thead>
                                        <tr>
                                            <th>Category</th>
                                            <th>Total</th>
                                            <th>Errors</th>
                                            <th>Warnings</th>
                                            <th>Information</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${rows.map(([name, row]) => `
                                            <tr>
                                                <td>${escapeHtml(name)}</td>
                                                <td>${escapeHtml(row.total ?? '-')}</td>
                                                <td>${escapeHtml(row.error_count ?? '-')}</td>
                                                <td>${escapeHtml(row.warning_count ?? '-')}</td>
                                                <td>${escapeHtml(row.information_count ?? '-')}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        ` : ''}
                    </section>
                `;
            }

            function buildExecutiveKpis(summary) {
                const overall = summary?.overall_summary || {};
                const errors = Number(overall.total_errors || 0);
                const warnings = Number(overall.total_warnings || 0);
                const anomalies = errors + warnings;
                const dynamicRisk = calculateDynamicRiskMetrics(summary?.logs || {});
                const riskScore = dynamicRisk.score;
                const riskTrendArrow = dynamicRisk.trendArrow;
                const riskChangeLabel = dynamicRisk.lastHourChangeLabel;
                const threatAssessment = riskScore >= 70 ? 'Critical' : (riskScore >= 40 ? 'Elevated' : 'Low');

                let securityPosture = 'Healthy';
                if (riskScore >= 70) securityPosture = 'At Risk';
                else if (riskScore >= 40) securityPosture = 'Degraded';

                return [
                    { label: 'Active Critical Issues', value: errors },
                    { label: 'Unresolved Warnings', value: warnings },
                    { label: 'Anomalies Detected', value: anomalies },
                    { label: 'Risk Score', value: `${riskScore}% ${riskTrendArrow} (${riskChangeLabel})` },
                    { label: 'Threat Assessment', value: threatAssessment },
                    { label: 'Security Posture', value: securityPosture }
                ];
            }

            function calculateDynamicRiskMetrics(logsByCategory) {
                const rows = flattenLogRows(logsByCategory);
                if (!rows.length) {
                    return {
                        score: 0,
                        trendArrow: '-',
                        lastHourChange: 0,
                        lastHourChangeLabel: '0 last hour'
                    };
                }

                const computeRawScore = (subset) => {
                    let errors = 0;
                    let warnings = 0;
                    let restarts = 0;
                    let networkErrors = 0;
                    let securityEvents = 0;

                    subset.forEach((row) => {
                        const level = String(row.level || '').toLowerCase();
                        const category = String(row.category || '').toLowerCase();
                        if (level === 'error' || level === 'critical') errors += 1;
                        else if (level === 'warning') warnings += 1;
                        if (isServiceRestartEvent(row)) restarts += 1;
                        if (isNetworkErrorEvent(row)) networkErrors += 1;
                        if (category.includes('security')) securityEvents += 1;
                    });

                    return (errors * 10) + (warnings * 5) + (restarts * 7) + (networkErrors * 8) + (securityEvents * 12);
                };

                const rawScore = computeRawScore(rows);
                const maxPerEvent = 42;
                const normalized = Math.max(0, Math.min(100, Math.round((rawScore / Math.max(rows.length * maxPerEvent, 1)) * 100)));

                const timeValues = rows
                    .map((row) => new Date(row.timestamp).getTime())
                    .filter((value) => Number.isFinite(value))
                    .sort((a, b) => a - b);

                if (!timeValues.length) {
                    return {
                        score: normalized,
                        trendArrow: normalized >= 50 ? '^' : 'v',
                        lastHourChange: 0,
                        lastHourChangeLabel: '0 last hour'
                    };
                }

                const end = timeValues[timeValues.length - 1];
                const oneHour = 60 * 60 * 1000;
                const lastHourRows = rows.filter((row) => {
                    const t = new Date(row.timestamp).getTime();
                    return Number.isFinite(t) && t > (end - oneHour) && t <= end;
                });
                const previousHourRows = rows.filter((row) => {
                    const t = new Date(row.timestamp).getTime();
                    return Number.isFinite(t) && t > (end - (2 * oneHour)) && t <= (end - oneHour);
                });

                const normalizeSubset = (subset) => {
                    const subsetRaw = computeRawScore(subset);
                    return Math.max(0, Math.min(100, Math.round((subsetRaw / Math.max(subset.length * maxPerEvent, 1)) * 100)));
                };

                const lastHourScore = normalizeSubset(lastHourRows);
                const previousHourScore = normalizeSubset(previousHourRows);
                const delta = lastHourScore - previousHourScore;
                const trendArrow = delta > 1 ? '^' : (delta < -1 ? 'v' : '-');
                const prefix = delta > 0 ? '+' : '';

                return {
                    score: normalized,
                    trendArrow,
                    lastHourChange: delta,
                    lastHourChangeLabel: `${prefix}${delta} last hour`
                };
            }

            function renderCategoryCards(categorySummary) {
                const rows = Object.entries(categorySummary || {});
                if (!rows.length) return '';
                return `
                    <div class="category-summary-grid">
                        ${rows.map(([name, row]) => `
                            <div class="category-summary-card" style="box-shadow: inset 3px 0 0 ${getCategoryColor(name)};">
                                <h4>${escapeHtml(name)} <span style="opacity:.8;font-weight:400;">(${escapeHtml(row.total ?? 0)} logs)</span></h4>
                                <div class="category-kpis">
                                    <span class="kpi-pill error">Errors: ${escapeHtml(row.error_count ?? 0)}</span>
                                    <span class="kpi-pill warn">Warnings: ${escapeHtml(row.warning_count ?? 0)}</span>
                                    <span class="kpi-pill info">Info: ${escapeHtml(row.information_count ?? 0)}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            function renderCharts(summary) {
                const categorySummary = summary.category_summary || {};
                const categories = Object.keys(categorySummary);
                const categoryCanvas = document.getElementById('categoryStackedChart');
                const severityTrendCanvas = document.getElementById('severityTrendChart');
                if (!categoryCanvas || !severityTrendCanvas || typeof Chart === 'undefined') return;

                if (categoryStackedChart) categoryStackedChart.destroy();
                categoryStackedChart = new Chart(categoryCanvas.getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels: categories,
                        datasets: [
                            {
                                label: 'Errors',
                                data: categories.map((c) => Number(categorySummary[c]?.error_count || 0)),
                                backgroundColor: '#ff6384'
                            },
                            {
                                label: 'Warnings',
                                data: categories.map((c) => Number(categorySummary[c]?.warning_count || 0)),
                                backgroundColor: '#ffce56'
                            },
                            {
                                label: 'Information',
                                data: categories.map((c) => Number(categorySummary[c]?.information_count || 0)),
                                backgroundColor: '#36a2eb'
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            x: {
                                stacked: true,
                                ticks: { color: '#c4cfed' },
                                grid: { color: 'rgba(255,255,255,0.08)' }
                            },
                            y: {
                                stacked: true,
                                beginAtZero: true,
                                ticks: { color: '#c4cfed', precision: 0 },
                                grid: { color: 'rgba(255,255,255,0.08)' }
                            }
                        },
                        plugins: {
                            legend: { labels: { color: '#dbe4ff' } }
                        }
                    }
                });

                const severityTrend = buildSeverityTimelineDataset(summary.logs || {});
                if (severityTrendChart) severityTrendChart.destroy();
                severityTrendChart = new Chart(severityTrendCanvas.getContext('2d'), {
                    type: 'line',
                    data: {
                        labels: severityTrend.labels,
                        datasets: severityTrend.datasets
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        scales: {
                            x: {
                                stacked: true,
                                ticks: { color: '#c4cfed', maxRotation: 0, minRotation: 0, autoSkip: true, maxTicksLimit: 12 },
                                grid: { color: 'rgba(255,255,255,0.08)' }
                            },
                            y: {
                                stacked: true,
                                beginAtZero: true,
                                ticks: { color: '#c4cfed', precision: 0 },
                                grid: { color: 'rgba(255,255,255,0.08)' }
                            }
                        },
                        plugins: {
                            legend: { labels: { color: '#dbe4ff' } }
                        }
                    }
                });

                renderCategoryTimelineChart(summary.logs || {}, timelineAggregationMode);
            }

            function buildSeverityTimelineDataset(logsByCategory) {
                const allEvents = [];
                Object.values(logsByCategory || {}).forEach((logs) => {
                    (Array.isArray(logs) ? logs : []).forEach((log) => allEvents.push(log));
                });

                const aggMinutes = allEvents.length > 220 ? 15 : (allEvents.length > 80 ? 5 : 1);
                const bucketKeys = new Set();
                const bySeverity = {
                    errors: {},
                    warnings: {},
                    info: {}
                };

                Object.values(logsByCategory || {}).forEach((logs) => {
                    (Array.isArray(logs) ? logs : []).forEach((log) => {
                        const d = new Date(log.timestamp);
                        if (Number.isNaN(d.getTime())) return;
                        const key = getTimelineBucketKey(d, String(aggMinutes));
                        bucketKeys.add(key);

                        const level = String(log.level || '').toLowerCase();
                        if (level === 'error' || level === 'critical') {
                            bySeverity.errors[key] = (bySeverity.errors[key] || 0) + 1;
                        } else if (level === 'warning') {
                            bySeverity.warnings[key] = (bySeverity.warnings[key] || 0) + 1;
                        } else {
                            bySeverity.info[key] = (bySeverity.info[key] || 0) + 1;
                        }
                    });
                });

                const labels = Array.from(bucketKeys).map((k) => Number(k)).sort((a, b) => a - b);
                const labelText = labels.map((k) => formatTimelineBucketLabel(k, String(aggMinutes)));
                const datasets = [
                    {
                        label: 'Errors',
                        data: labels.map((k) => bySeverity.errors[k] || 0),
                        borderColor: '#ff6384',
                        backgroundColor: 'rgba(255, 99, 132, 0.35)',
                        tension: 0.35,
                        fill: true,
                        pointRadius: 0
                    },
                    {
                        label: 'Warnings',
                        data: labels.map((k) => bySeverity.warnings[k] || 0),
                        borderColor: '#ffce56',
                        backgroundColor: 'rgba(255, 206, 86, 0.35)',
                        tension: 0.35,
                        fill: true,
                        pointRadius: 0
                    },
                    {
                        label: 'Information',
                        data: labels.map((k) => bySeverity.info[k] || 0),
                        borderColor: '#36a2eb',
                        backgroundColor: 'rgba(54, 162, 235, 0.35)',
                        tension: 0.35,
                        fill: true,
                        pointRadius: 0
                    }
                ];

                return { labels: labelText, datasets };
            }

            function setupTimelineAggregationControls(logsByCategory) {
                const container = document.getElementById('timelineAggregationControls');
                if (!container || container.dataset.bound === '1') return;
                container.dataset.bound = '1';

                const setActive = (selected) => {
                    container.querySelectorAll('.log-filter-btn').forEach((btn) => {
                        btn.classList.toggle('active', String(btn.getAttribute('data-timeline-agg')) === selected);
                    });
                };

                setActive(timelineAggregationMode);

                container.addEventListener('click', (event) => {
                    const button = event.target.closest('[data-timeline-agg]');
                    if (!button) return;
                    const nextMode = String(button.getAttribute('data-timeline-agg') || 'raw');
                    timelineAggregationMode = nextMode;
                    setActive(nextMode);
                    renderCategoryTimelineChart(logsByCategory, nextMode);
                });
            }

            function renderCategoryTimelineChart(logsByCategory, aggregationMode = 'raw') {
                const canvas = document.getElementById('timelineCategoryChart');
                if (!canvas || typeof Chart === 'undefined') return;

                const timelineData = buildCategoryTimelineDatasets(logsByCategory, aggregationMode);
                if (timelineCategoryChart) timelineCategoryChart.destroy();

                timelineCategoryChart = new Chart(canvas.getContext('2d'), {
                    type: 'line',
                    data: {
                        labels: timelineData.labels,
                        datasets: timelineData.datasets
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        scales: {
                            x: {
                                ticks: { color: '#c4cfed', maxRotation: 0, minRotation: 0, autoSkip: true, maxTicksLimit: 14 },
                                grid: { color: 'rgba(255,255,255,0.08)' }
                            },
                            y: {
                                beginAtZero: true,
                                ticks: { color: '#c4cfed', precision: 0 },
                                grid: { color: 'rgba(255,255,255,0.08)' }
                            }
                        },
                        plugins: {
                            legend: { labels: { color: '#dbe4ff' } },
                            zoom: {
                                limits: { x: { min: 0 }, y: { min: 0 } },
                                pan: { enabled: true, mode: 'x' },
                                zoom: {
                                    wheel: { enabled: true },
                                    pinch: { enabled: true },
                                    drag: { enabled: true },
                                    mode: 'x'
                                }
                            }
                        }
                    }
                });
            }

            function buildCategoryTimelineDatasets(logsByCategory, aggregationMode = 'raw') {
                const bucketKeys = new Set();
                const perCategory = {};
                const totalByBucket = {};
                const categories = Object.keys(logsByCategory || {});

                categories.forEach((category) => {
                    const logs = Array.isArray(logsByCategory[category]) ? logsByCategory[category] : [];
                    const bucket = {};

                    logs.forEach((log) => {
                        const d = new Date(log.timestamp);
                        if (Number.isNaN(d.getTime())) return;
                        const key = getTimelineBucketKey(d, aggregationMode);
                        bucket[key] = (bucket[key] || 0) + 1;
                        totalByBucket[key] = (totalByBucket[key] || 0) + 1;
                        bucketKeys.add(key);
                    });

                    perCategory[category] = bucket;
                });

                const labels = Array.from(bucketKeys)
                    .map((key) => Number(key))
                    .sort((a, b) => a - b);

                const labelText = labels.map((value) => formatTimelineBucketLabel(value, aggregationMode));

                const categoryDatasets = categories.map((category) => ({
                    label: category,
                    data: labels.map((k) => perCategory[category][k] || 0),
                    borderColor: getCategoryColor(category),
                    backgroundColor: getCategoryColor(category) + '33',
                    tension: 0.25,
                    fill: false,
                    pointRadius: 0,
                    borderWidth: 2
                }));

                const totalSeries = labels.map((k) => totalByBucket[k] || 0);
                const rollingWindow = aggregationMode === '15' ? 4 : (aggregationMode === '5' ? 6 : 10);
                const rollingAverage = computeRollingAverage(totalSeries, rollingWindow);
                const anomalies = computeAnomalyMarkers(totalSeries, rollingAverage);

                const overlays = [
                    {
                        label: 'Rolling Avg (Total)',
                        data: rollingAverage,
                        borderColor: '#eaf0ff',
                        borderDash: [6, 4],
                        tension: 0.2,
                        fill: false,
                        pointRadius: 0,
                        borderWidth: 2
                    },
                    {
                        label: 'Anomaly Flags',
                        data: anomalies,
                        borderColor: '#ff4d6d',
                        backgroundColor: '#ff4d6d',
                        showLine: false,
                        pointRadius: 4,
                        pointHoverRadius: 5
                    }
                ];

                return { labels: labelText, datasets: [...categoryDatasets, ...overlays] };
            }

            function getTimelineBucketKey(date, aggregationMode) {
                const d = new Date(date.getTime());
                if (aggregationMode === 'raw') {
                    d.setMilliseconds(0);
                    return d.getTime();
                }

                const minutes = Number(aggregationMode) || 1;
                d.setSeconds(0, 0);
                const roundedMinute = Math.floor(d.getMinutes() / minutes) * minutes;
                d.setMinutes(roundedMinute);
                return d.getTime();
            }

            function formatTimelineBucketLabel(timestamp, aggregationMode) {
                const d = new Date(timestamp);
                const sameDay = d.toDateString() === new Date().toDateString();
                const timeText = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                if (aggregationMode === 'raw') return sameDay ? timeText : `${d.toLocaleDateString()} ${timeText}`;
                return sameDay ? timeText : `${d.toLocaleDateString()} ${timeText}`;
            }

            function computeRollingAverage(values, windowSize) {
                const out = [];
                let runningSum = 0;

                for (let i = 0; i < values.length; i += 1) {
                    runningSum += Number(values[i] || 0);
                    if (i >= windowSize) {
                        runningSum -= Number(values[i - windowSize] || 0);
                    }
                    const divisor = Math.min(i + 1, windowSize);
                    out.push(Number((runningSum / Math.max(divisor, 1)).toFixed(2)));
                }

                return out;
            }

            function computeAnomalyMarkers(values, baseline) {
                if (!Array.isArray(values) || !values.length) return [];
                const mean = values.reduce((sum, v) => sum + Number(v || 0), 0) / values.length;
                const variance = values.reduce((sum, v) => {
                    const delta = Number(v || 0) - mean;
                    return sum + (delta * delta);
                }, 0) / values.length;
                const stdDev = Math.sqrt(Math.max(variance, 0));
                const p95 = computePercentile(values, 95);

                return values.map((value, index) => {
                    const current = Number(value || 0);
                    const base = Number(baseline[index] || 0);
                    const safeBase = Math.max(base, 1);
                    const deviationPct = ((current - safeBase) / safeBase) * 100;
                    const zScore = stdDev > 0 ? ((current - mean) / stdDev) : 0;
                    const isBurst = zScore >= 2 && deviationPct >= 100 && current >= p95;
                    return isBurst ? current : null;
                });
            }

            function computePercentile(values, percentile) {
                const arr = (Array.isArray(values) ? values : [])
                    .map((v) => Number(v || 0))
                    .sort((a, b) => a - b);
                if (!arr.length) return 0;
                const rank = (Math.max(0, Math.min(100, Number(percentile || 0))) / 100) * (arr.length - 1);
                const low = Math.floor(rank);
                const high = Math.ceil(rank);
                if (low === high) return arr[low];
                const frac = rank - low;
                return arr[low] + ((arr[high] - arr[low]) * frac);
            }

            function buildCategoryCountTimeline(rows, aggregationMode = '5') {
                const bucketMap = {};
                (Array.isArray(rows) ? rows : []).forEach((row) => {
                    const d = new Date(row?.timestamp);
                    if (Number.isNaN(d.getTime())) return;
                    const key = getTimelineBucketKey(d, aggregationMode);
                    bucketMap[key] = (bucketMap[key] || 0) + 1;
                });
                const buckets = Object.keys(bucketMap).map((k) => Number(k)).sort((a, b) => a - b);
                const values = buckets.map((k) => Number(bucketMap[k] || 0));
                return { buckets, values };
            }

            function renderAssessmentSection(assessments, summary) {
                const logsByCategory = summary?.logs || {};
                const filteredAssessments = (Array.isArray(assessments) ? assessments : [])
                    .filter((item) => {
                        const category = String(item?.category || '').toLowerCase();
                        return category && category !== 'unknown';
                    });

                if (!filteredAssessments.length) return '';
                return `
                    <section class="result-section">
                        <h3 class="section-title-xl">AI Risk Assessments</h3>
                        <div class="assessment-list">
                            ${filteredAssessments.map((item) => {
                    const category = String(item.category || '');
                    const riskLevel = String(item.risk_level || item.intelligence?.risk_level || 'Unknown');
                    const score = item.risk_score ?? item.intelligence?.risk_score ?? '-';
                    const confidence = String(item.confidence || item.intelligence?.confidence || '-');
                    const status = String(item.system_status || item.intelligence?.system_status || '-');
                    const categorySummary = findCategorySummary(summary?.category_summary || {}, category);
                    const categoryLogs = findCategoryLogs(logsByCategory, category);
                    const keyDrivers = buildAssessmentKeyDrivers(categorySummary, categoryLogs);
                    const riskFactors = buildAssessmentRiskFactors(categorySummary, categoryLogs);
                    const threatAssessment = deriveThreatAssessment(riskLevel, status);
                    const formattedScore = formatRiskScore(score, riskLevel);

                    return `
                                    <article class="assessment-card">
                                        <div class="assessment-header">
                                            <h4 class="assessment-category-subheading">${escapeHtml(category)}</h4>
                                            <span class="severity-badge ${riskToSeverityClass(riskLevel)}">${escapeHtml(riskLevel)}</span>
                                        </div>
                                        <div class="assessment-kv-grid">
                                            <div class="assessment-kv">
                                                <div class="assessment-kv-label">Threat Assessment</div>
                                                <div class="assessment-kv-value">${escapeHtml(threatAssessment)}</div>
                                            </div>
                                            <div class="assessment-kv">
                                                <div class="assessment-kv-label">Risk Score</div>
                                                <div class="assessment-kv-value">${escapeHtml(formattedScore)}</div>
                                            </div>
                                            <div class="assessment-kv">
                                                <div class="assessment-kv-label">Confidence</div>
                                                <div class="assessment-kv-value">${escapeHtml(confidence)}</div>
                                            </div>
                                            <div class="assessment-kv">
                                                <div class="assessment-kv-label">Status</div>
                                                <div class="assessment-kv-value">${escapeHtml(status)}</div>
                                            </div>
                                        </div>
                                        <p class="result-meta"><strong>Key Drivers</strong></p>
                                        <ul class="signal-list">
                                            ${keyDrivers.map((driver) => `<li>${renderSignalLine(driver)}</li>`).join('')}
                                        </ul>
                                        <p class="result-meta"><strong>Risk Factors</strong></p>
                                        <ul class="signal-list">
                                            ${riskFactors.map((factor) => `<li>${renderSignalLine(factor)}</li>`).join('')}
                                        </ul>
                                        ${item.report_markdown ? `
                                            <div class="markdown-content">
                                                <p><strong>Analyst Notes:</strong></p>
                                                ${markdownToHtml(stripAssessmentMetricLines(item.report_markdown))}
                                            </div>
                                        ` : ''}
                                    </article>
                                `;
                }).join('')}
                        </div>
                    </section>
                `;
            }

            function deriveThreatAssessment(riskLevel, status) {
                const level = String(riskLevel || '').toLowerCase();
                const state = String(status || '').toLowerCase();
                if (level.includes('critical') || level.includes('high') || state.includes('degraded')) return 'Elevated';
                if (level.includes('moderate') || level.includes('medium')) return 'Guarded';
                return 'Stable';
            }

            function stripAssessmentMetricLines(markdown) {
                const lines = String(markdown || '').split('\n');
                return lines.filter((line) => {
                    const value = line.trim().toLowerCase();
                    if (!value) return true;
                    if (value.includes('risk score')) return false;
                    if (value.includes('confidence level') || value.includes('confidence:')) return false;
                    if (value.includes('threat assessment')) return false;
                    if (value.includes('explanation:') && (value.includes('low') || value.includes('risk') || value.includes('score'))) return false;
                    if ((value.startsWith('low') || value.startsWith('medium') || value.startsWith('high') || value.startsWith('critical')) && value.includes('explanation')) return false;
                    if (/^score\s*[:\-]/.test(value)) return false;
                    if (/^\d+\s*(\/\s*100)?$/.test(value)) return false;
                    return true;
                }).join('\n');
            }

            function renderSignalLine(text) {
                const icon = pickSignalIcon(text);
                return `<i data-lucide="${escapeHtml(icon)}"></i><span>${escapeHtml(text)}</span>`;
            }

            function pickSignalIcon(text) {
                const value = String(text || '').toLowerCase();
                if (value.includes('error') || value.includes('critical')) return 'alert-triangle';
                if (value.includes('security') || value.includes('authentication')) return 'shield-alert';
                if (value.includes('restart') || value.includes('service')) return 'refresh-cw';
                if (value.includes('network') || value.includes('connectivity') || value.includes('connection')) return 'network';
                return 'circle-dot';
            }

            function renderCorrelationSection(clusters) {
                return `
                    <section class="result-section">
                        <h3>&#128260; Cross-Category Correlation</h3>
                        <div class="assessment-list">
                            ${clusters.map((cluster) => `
                                <article class="assessment-card">
                                    <div class="assessment-header">
                                        <h4>&#9888; Correlated Event Cluster Detected (${escapeHtml(cluster.windowLabel)})</h4>
                                        <span class="severity-badge severity-high">${escapeHtml(cluster.severityLabel)}</span>
                                    </div>
                                    <p class="result-meta"><strong>Correlation:</strong> ${escapeHtml(cluster.summary)}</p>
                                    <ul>
                                        ${cluster.bullets.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
                                    </ul>
                                    <p class="result-meta"><strong>Risk Factors:</strong></p>
                                    <ul>
                                        ${cluster.riskFactors.map((factor) => `<li>&#9888; ${escapeHtml(factor)}</li>`).join('')}
                                    </ul>
                                </article>
                            `).join('')}
                        </div>
                    </section>
                `;
            }

            function renderAnomalyDetectionSection(bursts) {
                return `
                    <section class="result-section">
                        <h3>&#128293; Anomaly Detection Layer</h3>
                        <div class="assessment-list">
                            ${bursts.map((burst) => `
                                <article class="assessment-card">
                                    <div class="assessment-header">
                                        <h4>&#128293; Log Burst Detected (${escapeHtml(burst.category)} Category)</h4>
                                        <span class="severity-badge severity-critical">Burst</span>
                                    </div>
                                    <p class="result-meta"><strong>Window:</strong> ${escapeHtml(burst.windowLabel)}</p>
                                    <p class="result-meta"><strong>Deviation:</strong> +${escapeHtml(burst.deviationPct)}% from baseline</p>
                                    <ul>
                                        <li>Z-score: ${escapeHtml(burst.zScore)}</li>
                                        <li>Current Count: ${escapeHtml(burst.currentCount)}</li>
                                        <li>Moving Avg Baseline: ${escapeHtml(burst.baseline)}</li>
                                        <li>95th Percentile Threshold: ${escapeHtml(burst.percentile95)}</li>
                                    </ul>
                                </article>
                            `).join('')}
                        </div>
                    </section>
                `;
            }

            function detectStatisticalLogBursts(logsByCategory) {
                const categories = Object.keys(logsByCategory || {});
                const findings = [];

                categories.forEach((category) => {
                    const timeline = buildCategoryCountTimeline(logsByCategory[category], '5');
                    const values = timeline.values;
                    if (values.length < 6) return;

                    const mean = values.reduce((sum, v) => sum + Number(v || 0), 0) / values.length;
                    const variance = values.reduce((sum, v) => {
                        const delta = Number(v || 0) - mean;
                        return sum + (delta * delta);
                    }, 0) / values.length;
                    const stdDev = Math.sqrt(Math.max(variance, 0));
                    const rolling = computeRollingAverage(values, 6);
                    const p95 = computePercentile(values, 95);

                    let strongest = null;
                    values.forEach((count, index) => {
                        const current = Number(count || 0);
                        const baseline = Number(rolling[index] || 0);
                        const safeBaseline = Math.max(baseline, 1);
                        const deviationPct = ((current - safeBaseline) / safeBaseline) * 100;
                        const zScore = stdDev > 0 ? ((current - mean) / stdDev) : 0;
                        const passes = zScore >= 2 && deviationPct >= 100 && current >= p95;
                        if (!passes) return;
                        if (!strongest || zScore > strongest.zScoreValue) {
                            strongest = {
                                category,
                                windowLabel: formatTimelineBucketLabel(timeline.buckets[index], '5'),
                                deviationPct: Math.round(Math.max(0, deviationPct)),
                                zScore: zScore.toFixed(2),
                                zScoreValue: zScore,
                                currentCount: current,
                                baseline: baseline.toFixed(2),
                                percentile95: Number(p95.toFixed(2))
                            };
                        }
                    });

                    if (strongest) findings.push(strongest);
                });

                return findings
                    .sort((a, b) => b.zScoreValue - a.zScoreValue)
                    .slice(0, 6);
            }

            function renderTopPatternsSection(patterns) {
                return `
                    <section class="result-section">
                        <h3 class="section-title-xl">&#128204; Event Pattern Analysis</h3>
                        <div class="summary-grid">
                            ${patterns.map((row) => `
                                <div class="summary-item">
                                    <div class="summary-label">${escapeHtml(row.type)}</div>
                                    <div class="summary-value">${escapeHtml(row.count)}</div>
                                </div>
                            `).join('')}
                        </div>
                    </section>
                `;
            }

            function buildTopEventPatterns(logsByCategory, fallbackRawLogs) {
                const sourceRows = [];
                if (logsByCategory && typeof logsByCategory === 'object') {
                    Object.values(logsByCategory).forEach((rows) => {
                        (Array.isArray(rows) ? rows : []).forEach((row) => sourceRows.push(row));
                    });
                }
                if (!sourceRows.length && Array.isArray(fallbackRawLogs)) {
                    fallbackRawLogs.forEach((row) => sourceRows.push(row));
                }
                if (!sourceRows.length) return [];

                const counts = {};
                sourceRows.forEach((row) => {
                    const type = inferEventType(row);
                    counts[type] = (counts[type] || 0) + 1;
                });

                return Object.entries(counts)
                    .map(([type, count]) => ({ type, count }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 6);
            }

            function inferEventType(row) {
                const explicit = String(row?.event_id || '').trim().toLowerCase();
                if (explicit) return explicit;

                const msg = String(row?.message || '').toLowerCase();
                if (msg.includes('restart') || msg.includes('restarted')) return 'service_restart';
                if (msg.includes('install') || msg.includes('installation')) return 'installation_event';
                if (msg.includes('network') || msg.includes('connection') || msg.includes('timeout')) return 'network_error';
                if (msg.includes('failed login') || msg.includes('authentication failure')) return 'failed_login';
                return 'generic';
            }

            function buildEventIdHeatmap(logsByCategory, fallbackRawLogs) {
                const rows = flattenLogRows(logsByCategory, fallbackRawLogs);
                if (!rows.length) return [];

                const stats = {};
                rows.forEach((row) => {
                    const id = String(row.event_id || inferEventType(row) || 'generic').toLowerCase();
                    if (!stats[id]) {
                        stats[id] = { count: 0, errors: 0, warnings: 0, info: 0 };
                    }
                    stats[id].count += 1;
                    const level = String(row.level || '').toLowerCase();
                    if (level === 'error' || level === 'critical') stats[id].errors += 1;
                    else if (level === 'warning') stats[id].warnings += 1;
                    else stats[id].info += 1;
                });

                const counts = Object.values(stats).map((row) => row.count);
                const mean = counts.reduce((sum, value) => sum + value, 0) / Math.max(counts.length, 1);
                const maxCount = counts.reduce((m, v) => Math.max(m, Number(v || 0)), 0);
                const variance = counts.reduce((sum, value) => {
                    const delta = value - mean;
                    return sum + (delta * delta);
                }, 0) / Math.max(counts.length, 1);
                const stdDev = Math.sqrt(Math.max(variance, 0));
                const spikeThreshold = mean + Math.max(1.5, stdDev);

                return Object.entries(stats)
                    .map(([eventId, row]) => ({
                        eventId,
                        count: row.count,
                        severity: dominantSeverity(row),
                        spike: row.count >= spikeThreshold,
                        intensity: maxCount > 0 ? Math.round((row.count / maxCount) * 100) : 0
                    }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 12);
            }

            function dominantSeverity(row) {
                if (row.errors > 0) return 'Error';
                if (row.warnings > 0) return 'Warning';
                return 'Information';
            }

            function renderEventIdHeatmapSection(items) {
                return `
                    <section class="result-section">
                        <h3>Event ID Heatmap</h3>
                        <div class="results-table-container">
                            <table class="data-table heatmap-table">
                                <thead>
                                    <tr>
                                        <th>Event ID</th>
                                        <th>Count</th>
                                        <th>Severity</th>
                                        <th>Spike?</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${items.map((item) => `
                                        <tr>
                                            <td>${escapeHtml(item.eventId)}</td>
                                            <td><span class="heat-intensity" style="background: linear-gradient(90deg, rgba(255,99,132,0.08), rgba(255,99,132,${Math.max(0.14, item.intensity / 100)}));">${escapeHtml(item.count)}</span></td>
                                            <td>${renderLevelBadge(item.severity)}</td>
                                            <td class="${item.spike ? 'spike-yes' : ''}">${item.spike ? 'Yes' : 'No'}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </section>
                `;
            }

            function renderAdvancedLogExplorerSection(logsByCategory) {
                const fromLogs = Object.keys(logsByCategory || {}).map((item) => String(item));
                const categories = Array.from(new Set(['Application', 'System', 'Security', ...fromLogs]));
                return `
                    <section class="result-section">
                        <h3>Raw Log Events</h3>
                        <div class="advanced-filter-grid" id="advancedLogFilters">
                            <select id="filterCategory">
                                <option value="all">All Categories</option>
                                ${categories.map((name) => `<option value="${escapeHtml(String(name).toLowerCase())}">${escapeHtml(name)}</option>`).join('')}
                            </select>
                            <select id="filterSeverity">
                                <option value="all">All Severity</option>
                                <option value="error">Error</option>
                                <option value="critical">Critical</option>
                                <option value="warning">Warning</option>
                                <option value="info">Info</option>
                                <option value="information">Information</option>
                            </select>
                            <input type="text" id="filterEventId" placeholder="Event ID filter">
                            <input type="datetime-local" id="filterStartTime" title="Start time">
                            <input type="datetime-local" id="filterEndTime" title="End time">
                            <input type="text" id="filterKeyword" placeholder="Keyword search">
                            <button type="button" class="clear-filter-btn" id="clearAdvancedFilters">Clear Filters</button>
                        </div>
                        <p class="result-meta" id="advancedLogMeta"></p>
                        <div id="advancedLogTableContainer"></div>
                    </section>
                `;
            }

            function setupAdvancedLogExplorer(logsByCategory) {
                const container = document.getElementById('advancedLogTableContainer');
                if (!container) return;

                const allRows = flattenLogRows(logsByCategory);
                const controls = {
                    category: document.getElementById('filterCategory'),
                    severity: document.getElementById('filterSeverity'),
                    eventId: document.getElementById('filterEventId'),
                    start: document.getElementById('filterStartTime'),
                    end: document.getElementById('filterEndTime'),
                    keyword: document.getElementById('filterKeyword'),
                    clear: document.getElementById('clearAdvancedFilters'),
                    meta: document.getElementById('advancedLogMeta')
                };
                if (!controls.category || !controls.severity || !controls.eventId || !controls.start || !controls.end || !controls.keyword || !controls.clear || !controls.meta) return;

                const eventIdCounts = {};
                allRows.forEach((row) => {
                    const id = String(row.event_id || inferEventType(row) || 'generic').toLowerCase();
                    eventIdCounts[id] = (eventIdCounts[id] || 0) + 1;
                });

                const readFilters = () => ({
                    category: String(controls.category.value || 'all').toLowerCase(),
                    severity: String(controls.severity.value || 'all').toLowerCase(),
                    eventId: String(controls.eventId.value || '').trim().toLowerCase(),
                    keyword: String(controls.keyword.value || '').trim().toLowerCase(),
                    startMs: controls.start.value ? new Date(controls.start.value).getTime() : null,
                    endMs: controls.end.value ? new Date(controls.end.value).getTime() : null
                });

                const applyFilters = (rows, filters) => rows.filter((row) => {
                    const category = String(row.category || '').toLowerCase();
                    if (filters.category !== 'all' && category !== filters.category) return false;

                    const level = String(row.level || '').toLowerCase();
                    if (filters.severity !== 'all') {
                        if (filters.severity === 'info' && !(level === 'info' || level === 'information')) return false;
                        else if (filters.severity !== 'info' && level !== filters.severity) return false;
                    }

                    const eventId = String(row.event_id || inferEventType(row) || '').toLowerCase();
                    if (filters.eventId && !eventId.includes(filters.eventId)) return false;

                    const message = String(row.message || '').toLowerCase();
                    if (filters.keyword && !message.includes(filters.keyword) && !eventId.includes(filters.keyword)) return false;

                    const t = new Date(row.timestamp).getTime();
                    if (Number.isFinite(filters.startMs) && Number.isFinite(t) && t < filters.startMs) return false;
                    if (Number.isFinite(filters.endMs) && Number.isFinite(t) && t > filters.endMs) return false;
                    return true;
                });

                const render = () => {
                    const filters = readFilters();
                    const filtered = applyFilters(allRows, filters)
                        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                    controls.meta.textContent = `Showing ${filtered.length} of ${allRows.length} log events`;
                    container.innerHTML = renderAdvancedLogTable(filtered, allRows, eventIdCounts);
                    bindExpandableRows(container);
                };

                ['change', 'input'].forEach((eventName) => {
                    controls.category.addEventListener(eventName, render);
                    controls.severity.addEventListener(eventName, render);
                    controls.eventId.addEventListener(eventName, render);
                    controls.start.addEventListener(eventName, render);
                    controls.end.addEventListener(eventName, render);
                    controls.keyword.addEventListener(eventName, render);
                });

                controls.clear.addEventListener('click', () => {
                    controls.category.value = 'all';
                    controls.severity.value = 'all';
                    controls.eventId.value = '';
                    controls.start.value = '';
                    controls.end.value = '';
                    controls.keyword.value = '';
                    render();
                });

                render();
            }

            function renderAdvancedLogTable(rows, allRows, eventIdCounts) {
                if (!rows.length) {
                    return '<p class="result-meta">No events match current filters.</p>';
                }

                return `
                    <div class="results-table-container">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Timestamp</th>
                                    <th>Category</th>
                                    <th>Event ID</th>
                                    <th>Level</th>
                                    <th>Message</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows.map((row, index) => renderExpandableLogRows(row, index, allRows, eventIdCounts)).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            }

            function renderExpandableLogRows(row, index, allRows, eventIdCounts) {
                const eventId = String(row.event_id || inferEventType(row) || 'generic');
                const eventIdKey = eventId.toLowerCase();
                const level = String(row.level || '').toLowerCase();
                const rowClasses = ['log-row-main'];
                if (level === 'error' || level === 'critical') rowClasses.push('error-row');
                if (level === 'warning') rowClasses.push('warning-row');
                if (Number(eventIdCounts[eventIdKey] || 0) >= 3) rowClasses.push('repeated-row');

                const detailId = `log-detail-${index}`;
                const parsed = parseLogFields(row);
                const related = findRelatedEvents(allRows, row).slice(0, 4);
                const contribution = computeEventRiskContribution(row);

                return `
                    <tr class="${rowClasses.join(' ')}" data-detail-id="${escapeHtml(detailId)}">
                        <td>${formatTimestamp(row.timestamp)}</td>
                        <td>${escapeHtml(row.category ?? '-')}</td>
                        <td>${escapeHtml(eventId)}</td>
                        <td>${renderLevelBadge(row.level)}</td>
                        <td>${escapeHtml(String(row.message || '-').slice(0, 110))}</td>
                    </tr>
                    <tr class="log-row-detail hidden" id="${escapeHtml(detailId)}">
                        <td colspan="5">
                            <div class="detail-block"><strong>Full Message:</strong> ${escapeHtml(row.message || '-')}</div>
                            <div class="detail-block"><strong>Parsed Fields:</strong><pre>${escapeHtml(JSON.stringify(parsed, null, 2))}</pre></div>
                            <div class="detail-block"><strong>Related Events:</strong>
                                <ul>
                                    ${related.length ? related.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : '<li>None detected</li>'}
                                </ul>
                            </div>
                            <div class="detail-block"><strong>Risk Contribution:</strong> ${escapeHtml(contribution)}</div>
                        </td>
                    </tr>
                `;
            }

            function bindExpandableRows(container) {
                container.querySelectorAll('.log-row-main').forEach((row) => {
                    row.addEventListener('click', () => {
                        const detailId = row.getAttribute('data-detail-id');
                        if (!detailId) return;
                        const detail = document.getElementById(detailId);
                        if (!detail) return;
                        detail.classList.toggle('hidden');
                    });
                });
            }

            function parseLogFields(row) {
                const parsed = {
                    timestamp: row.timestamp || null,
                    category: row.category || null,
                    event_id: row.event_id || inferEventType(row),
                    level: row.level || null,
                    host: row.host || row.hostname || row.computer || null
                };
                const message = String(row.message || '').trim();
                const jsonMatch = message.match(/\{[\s\S]*\}$/);
                if (jsonMatch) {
                    try {
                        parsed.message_json = JSON.parse(jsonMatch[0]);
                    } catch {
                        parsed.message_json = null;
                    }
                }
                return parsed;
            }

            function findRelatedEvents(allRows, sourceRow) {
                const sourceId = String(sourceRow.event_id || inferEventType(sourceRow) || '').toLowerCase();
                const sourceTime = new Date(sourceRow.timestamp).getTime();
                return allRows
                    .filter((row) => String(row.event_id || inferEventType(row) || '').toLowerCase() === sourceId)
                    .filter((row) => row !== sourceRow)
                    .sort((a, b) => Math.abs(new Date(a.timestamp).getTime() - sourceTime) - Math.abs(new Date(b.timestamp).getTime() - sourceTime))
                    .map((row) => `${formatTimestamp(row.timestamp)} | ${String(row.category || '-')} | ${String(row.message || '').slice(0, 90)}`);
            }

            function computeEventRiskContribution(row) {
                let points = 0;
                const contributions = [];
                const level = String(row.level || '').toLowerCase();
                const category = String(row.category || '').toLowerCase();

                if (level === 'error' || level === 'critical') {
                    points += 10;
                    contributions.push('Error +10');
                } else if (level === 'warning') {
                    points += 5;
                    contributions.push('Warning +5');
                }
                if (isServiceRestartEvent(row)) {
                    points += 7;
                    contributions.push('Restart +7');
                }
                if (isNetworkErrorEvent(row)) {
                    points += 8;
                    contributions.push('Network Error +8');
                }
                if (category.includes('security')) {
                    points += 12;
                    contributions.push('Security Event +12');
                }

                return `${points} points (${contributions.length ? contributions.join(', ') : 'No weighted factors'})`;
            }

            function flattenLogRows(logsByCategory, fallbackRawLogs = null) {
                const out = [];
                if (logsByCategory && typeof logsByCategory === 'object') {
                    Object.entries(logsByCategory).forEach(([category, rows]) => {
                        (Array.isArray(rows) ? rows : []).forEach((row) => {
                            out.push({
                                ...row,
                                category: row?.category || category
                            });
                        });
                    });
                }
                if (!out.length && Array.isArray(fallbackRawLogs)) {
                    fallbackRawLogs.forEach((row) => out.push(row));
                }
                return out;
            }

            function findCategorySummary(categorySummary, category) {
                const target = String(category || '').toLowerCase();
                const exactKey = Object.keys(categorySummary || {}).find((key) => String(key).toLowerCase() === target);
                if (exactKey) return categorySummary[exactKey] || {};
                const partialKey = Object.keys(categorySummary || {}).find((key) => {
                    const value = String(key).toLowerCase();
                    return value.includes(target) || target.includes(value);
                });
                if (partialKey) return categorySummary[partialKey] || {};
                return {};
            }

            function findCategoryLogs(logsByCategory, category) {
                const target = String(category || '').toLowerCase();
                const matchedKey = Object.keys(logsByCategory || {}).find((key) => String(key).toLowerCase() === target);
                if (matchedKey) return Array.isArray(logsByCategory?.[matchedKey]) ? logsByCategory[matchedKey] : [];
                const partialKey = Object.keys(logsByCategory || {}).find((key) => {
                    const value = String(key).toLowerCase();
                    return value.includes(target) || target.includes(value);
                });
                if (partialKey) return Array.isArray(logsByCategory?.[partialKey]) ? logsByCategory[partialKey] : [];
                return [];
            }

            function buildAssessmentKeyDrivers(categorySummary, categoryLogs) {
                const drivers = [];
                const critical = Number(categorySummary?.error_count || 0);
                const warnings = Number(categorySummary?.warning_count || 0);
                const info = Number(categorySummary?.information_count || 0);

                if (critical > 0) drivers.push(`${critical} Critical Events`);
                if (warnings > 0) drivers.push(`${warnings} Warning Events`);
                if (info > 0) drivers.push(`${info} Informational Events`);

                const restartCount = categoryLogs.filter((log) => isServiceRestartEvent(log)).length;
                const networkErrorCount = categoryLogs.filter((log) => isNetworkErrorEvent(log)).length;
                const failedLoginCount = categoryLogs.filter((log) => isFailedLoginEvent(log)).length;

                if (restartCount > 0) drivers.push(`${restartCount} Service Restarts`);
                if (networkErrorCount > 0) drivers.push(`${networkErrorCount} Network Errors`);
                if (failedLoginCount > 0) drivers.push(`${failedLoginCount} Failed Login Attempts`);
                if (!drivers.length) drivers.push('No major drivers detected in current scan window');
                return drivers;
            }

            function buildAssessmentRiskFactors(categorySummary, categoryLogs) {
                const factors = [];
                const critical = Number(categorySummary?.error_count || 0);
                const warnings = Number(categorySummary?.warning_count || 0);
                const restartCount = categoryLogs.filter((log) => isServiceRestartEvent(log)).length;
                const networkErrorCount = categoryLogs.filter((log) => isNetworkErrorEvent(log)).length;
                const failedLoginCount = categoryLogs.filter((log) => isFailedLoginEvent(log)).length;

                if (critical >= 2) factors.push('Elevated critical-event pressure');
                if (warnings >= 3) factors.push('Sustained warning accumulation');
                if (restartCount > 0) factors.push('Service instability signals');
                if (networkErrorCount > 0) factors.push('Connectivity anomalies');
                if (failedLoginCount > 0) factors.push('Potential authentication attack surface');
                if (!factors.length) factors.push('No immediate high-risk indicators');
                return factors;
            }

            function formatRiskScore(score, riskLevel) {
                const numericScore = Number(score);
                if (!Number.isFinite(numericScore)) {
                    return String(score ?? '-');
                }
                return `${numericScore}/100 (${riskLevel})`;
            }

            function detectCorrelatedEventClusters(logsByCategory) {
                const events = flattenLogsByCategory(logsByCategory);
                if (!events.length) return [];

                const clusters = [];
                const seen = new Set();

                const pushCluster = (startMs, endMs, summary) => {
                    const windowEvents = events.filter((event) => event.timeMs >= startMs && event.timeMs <= endMs);
                    const warningCount = windowEvents.filter((event) => event.level === 'warning').length;
                    const restartCount = windowEvents.filter((event) => isServiceRestartEvent(event)).length;
                    const networkErrorCount = windowEvents.filter((event) => isNetworkErrorEvent(event)).length;
                    const failedLoginCount = windowEvents.filter((event) => isFailedLoginEvent(event)).length;
                    const riskFactors = [];
                    if (restartCount > 0) riskFactors.push('Service instability signals');
                    if (networkErrorCount > 0) riskFactors.push('Connectivity anomalies');
                    if (failedLoginCount > 0) riskFactors.push('Authentication stress indicators');
                    if (warningCount >= 3) riskFactors.push('Warning-event burst pattern');
                    if (!riskFactors.length) riskFactors.push('Cross-domain event overlap');

                    const bucketKey = `${Math.floor(startMs / 60000)}-${Math.floor(endMs / 60000)}-${summary}`;
                    if (seen.has(bucketKey)) return;
                    seen.add(bucketKey);

                    clusters.push({
                        startMs,
                        windowLabel: `${formatTimestamp(new Date(startMs).toISOString())} - ${formatTimestamp(new Date(endMs).toISOString())}`,
                        summary,
                        severityLabel: warningCount >= 3 ? 'Heightened' : 'Correlated',
                        bullets: [
                            `${warningCount} Warning Events`,
                            `${restartCount} Service Restarts`,
                            `${networkErrorCount} Network Errors`,
                            `${failedLoginCount} Failed Login Events`
                        ],
                        riskFactors
                    });
                };

                const appRestarts = events.filter((event) => isCategory(event, 'application') && isServiceRestartEvent(event));
                appRestarts.forEach((appEvent) => {
                    const pair = events.find((candidate) =>
                        isCategory(candidate, 'system') &&
                        candidate.level === 'warning' &&
                        Math.abs(candidate.timeMs - appEvent.timeMs) <= (2 * 60 * 1000)
                    );
                    if (!pair) return;
                    pushCluster(
                        Math.min(appEvent.timeMs, pair.timeMs),
                        Math.max(appEvent.timeMs, pair.timeMs) + (2 * 60 * 1000),
                        'Application restart + System warning within 2 min'
                    );
                });

                const bucketMs = 3 * 60 * 1000;
                const securityBuckets = {};
                events.forEach((event) => {
                    if (!isCategory(event, 'security')) return;
                    const key = Math.floor(event.timeMs / bucketMs) * bucketMs;
                    if (!securityBuckets[key]) {
                        securityBuckets[key] = { total: 0, failedLogin: 0 };
                    }
                    securityBuckets[key].total += 1;
                    if (isFailedLoginEvent(event)) securityBuckets[key].failedLogin += 1;
                });
                Object.keys(securityBuckets).forEach((key) => {
                    const bucket = securityBuckets[key];
                    if (bucket.total >= 6 && bucket.failedLogin >= 3) {
                        const startMs = Number(key);
                        pushCluster(
                            startMs,
                            startMs + bucketMs,
                            'Security log spike + failed login burst'
                        );
                    }
                });

                const networkErrors = events.filter((event) => isNetworkErrorEvent(event));
                const serviceRestarts = events.filter((event) => isServiceRestartEvent(event));
                networkErrors.forEach((networkEvent) => {
                    const restart = serviceRestarts.find((event) =>
                        Math.abs(event.timeMs - networkEvent.timeMs) <= (2 * 60 * 1000)
                    );
                    if (!restart) return;
                    pushCluster(
                        Math.min(networkEvent.timeMs, restart.timeMs),
                        Math.max(networkEvent.timeMs, restart.timeMs) + (2 * 60 * 1000),
                        'Network error + service restart'
                    );
                });

                return clusters
                    .sort((a, b) => Number(a.startMs || 0) - Number(b.startMs || 0))
                    .slice(0, 8);
            }

            function flattenLogsByCategory(logsByCategory) {
                const out = [];
                Object.entries(logsByCategory || {}).forEach(([category, rows]) => {
                    (Array.isArray(rows) ? rows : []).forEach((row) => {
                        const d = new Date(row?.timestamp);
                        if (Number.isNaN(d.getTime())) return;
                        out.push({
                            category: String(row?.category || category || 'unknown').toLowerCase(),
                            level: String(row?.level || '').toLowerCase(),
                            message: String(row?.message || '').toLowerCase(),
                            timeMs: d.getTime()
                        });
                    });
                });
                return out.sort((a, b) => a.timeMs - b.timeMs);
            }

            function isCategory(event, categoryName) {
                return String(event?.category || '').includes(String(categoryName || '').toLowerCase());
            }

            function isServiceRestartEvent(event) {
                const msg = String(event?.message || '').toLowerCase();
                return msg.includes('restart') || msg.includes('restarted') || msg.includes('service started');
            }

            function isNetworkErrorEvent(event) {
                const msg = String(event?.message || '').toLowerCase();
                const level = String(event?.level || '').toLowerCase();
                const looksNetwork = msg.includes('network') || msg.includes('connection') || msg.includes('timeout');
                return looksNetwork && (level === 'error' || level === 'critical' || msg.includes('failed'));
            }

            function isFailedLoginEvent(event) {
                const msg = String(event?.message || '').toLowerCase();
                return msg.includes('failed login') || msg.includes('login failed') || msg.includes('authentication failure');
            }

            function renderLogTableHtml(rows, title = null, mode = 'default') {
                const countLabel = mode === 'compact' ? '' : `<p class="result-count">Found ${rows.length} log events</p>`;
                const categoryKey = rows.length > 0 ? String(rows[0].category || '').toLowerCase() : '';
                return `
                    <section class="result-section raw-log-category" data-log-category="${escapeHtml(categoryKey)}">
                        ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
                        ${countLabel}
                        <div class="results-table-container">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Timestamp</th>
                                        <th>Category</th>
                                        <th>Event ID</th>
                                        <th>Level</th>
                                        <th>Message</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rows.map((row) => `
                                        <tr>
                                            <td>${formatTimestamp(row.timestamp)}</td>
                                            <td>${escapeHtml(row.category ?? '-')}</td>
                                            <td>${escapeHtml(row.event_id ?? '-')}</td>
                                            <td>${renderLevelBadge(row.level)}</td>
                                            <td>${escapeHtml(row.message ?? '-')}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </section>
                `;
            }

            function extractRows(data) {
                if (Array.isArray(data)) return data;
                if (!data || typeof data !== 'object') return null;
                if (Array.isArray(data.items)) return data.items;
                if (Array.isArray(data.results)) return data.results;
                if (Array.isArray(data.logs)) return data.logs;
                if (Array.isArray(data.data)) return data.data;
                if (Array.isArray(data.output)) return data.output;
                if (Array.isArray(data.outputs)) return data.outputs;
                return null;
            }

            function buildStructuredPayloadFromLogRows(rows) {
                const grouped = {};
                let errors = 0;
                let warnings = 0;
                let info = 0;

                (Array.isArray(rows) ? rows : []).forEach((row) => {
                    const category = String(row.category || 'Unknown');
                    if (!grouped[category]) grouped[category] = [];
                    grouped[category].push(row);

                    const level = String(row.level || '').toLowerCase();
                    if (level === 'error' || level === 'critical') errors += 1;
                    else if (level === 'warning') warnings += 1;
                    else info += 1;
                });

                const categorySummary = {};
                Object.entries(grouped).forEach(([category, items]) => {
                    let ec = 0;
                    let wc = 0;
                    let ic = 0;
                    items.forEach((item) => {
                        const level = String(item.level || '').toLowerCase();
                        if (level === 'error' || level === 'critical') ec += 1;
                        else if (level === 'warning') wc += 1;
                        else ic += 1;
                    });
                    categorySummary[category] = {
                        total: items.length,
                        error_count: ec,
                        warning_count: wc,
                        information_count: ic
                    };
                });

                return {
                    assessments: [],
                    summary: {
                        metadata: {
                            scan_time: new Date().toISOString(),
                            user: '-',
                            admin_status: '-'
                        },
                        category_summary: categorySummary,
                        overall_summary: {
                            total_logs: rows.length,
                            total_errors: errors,
                            total_warnings: warnings,
                            total_information: info
                        },
                        logs: grouped
                    },
                    raw: rows
                };
            }

            function isLogEventRows(rows) {
                if (!Array.isArray(rows) || rows.length === 0) return false;
                const keys = ['timestamp', 'category', 'event_id', 'level', 'message'];
                const first = rows.find((row) => row && typeof row === 'object');
                if (!first) return false;
                return keys.every((key) => key in first);
            }

            function renderLogTable(rows) {
                resultsContent.innerHTML = renderLogTableHtml(rows);
                createIcons();
                resultsCard.scrollIntoView({ behavior: 'smooth' });
            }

            function renderTable(rows) {
                let html = `<p class="result-count">Found ${rows.length} records</p>`;
                html += '<div class="results-table-container"><table class="data-table">';

                if (rows.length > 0) {
                    const columns = Object.keys(rows[0]);
                    html += '<thead><tr>' + columns.map((c) => `<th>${c}</th>`).join('') + '</tr></thead>';
                    html += '<tbody>' + rows.map((row) =>
                        '<tr>' + columns.map((c) => `<td>${formatValue(row[c])}</td>`).join('') + '</tr>'
                    ).join('') + '</tbody>';
                }

                html += '</table></div>';
                resultsContent.innerHTML = html;
                createIcons();
                resultsCard.scrollIntoView({ behavior: 'smooth' });
            }

            async function parseWebhookResponse(response) {
                const raw = await response.text();
                const body = raw.trim();
                if (!body) return null;

                const contentType = response.headers.get('content-type') || '';
                const expectsJson = contentType.includes('application/json');

                // Try to parse as single JSON block or multiple JSON blocks (NDJSON-like or just concatenated)
                const tryMultipleJson = (text) => {
                    const results = [];
                    // This regex tries to find balanced braces or brackets at the top level
                    // However, a simpler approach for NDJSON/consecutive JSON is to split by potential boundaries
                    // or just use a progressive parser. Here we use a heuristic split.
                    const blocks = text.split(/\n(?=\{|\s*\[)/);
                    for (const block of blocks) {
                        const trimmed = block.trim();
                        if (!trimmed) continue;
                        try {
                            results.push(JSON.parse(trimmed));
                        } catch (e) {
                            // If split failed, try to find JSON objects using index searches
                        }
                    }
                    return results.length > 0 ? results : null;
                };

                if (expectsJson) {
                    try {
                        return coerceJsonLike(JSON.parse(body));
                    } catch (e) {
                        const multi = tryMultipleJson(body);
                        if (multi) return multi;
                    }
                }

                try {
                    return coerceJsonLike(JSON.parse(body));
                } catch {
                    const multi = tryMultipleJson(body);
                    if (multi) return multi;
                    return { message: body };
                }
            }

            function coerceJsonLike(value) {
                if (typeof value === 'string') {
                    const text = value.trim();
                    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
                        try {
                            return JSON.parse(text);
                        } catch {
                            return value;
                        }
                    }
                }

                if (value && typeof value === 'object' && typeof value.message === 'string') {
                    const text = value.message.trim();
                    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
                        try {
                            return JSON.parse(text);
                        } catch {
                            return value;
                        }
                    }
                }

                return value;
            }

            function formatValue(value) {
                if (value === null || value === undefined) return '-';
                if (typeof value === 'boolean') return value ? '&#10003;' : '&#10007;';
                if (typeof value === 'object') return escapeHtml(JSON.stringify(value));
                return escapeHtml(String(value));
            }

            function renderLevelBadge(level) {
                const text = String(level || 'Unknown').toUpperCase();
                let badgeClass = 'severity-none';
                if (text === 'ERROR' || text === 'CRITICAL') badgeClass = 'severity-critical';
                else if (text === 'WARNING') badgeClass = 'severity-high';
                else if (text === 'INFORMATION' || text === 'INFO') badgeClass = 'severity-low';
                return `<span class="severity-badge ${badgeClass}">${escapeHtml(text)}</span>`;
            }

            function formatTimestamp(value) {
                if (!value) return '-';
                const date = new Date(value);
                if (Number.isNaN(date.getTime())) return escapeHtml(String(value));
                return escapeHtml(date.toLocaleString());
            }

            function markdownToHtml(markdown) {
                if (!markdown) return '';
                const lines = String(markdown).split('\n');
                let html = '';
                let listDepth = 0;

                const closeListsTo = (targetDepth = 0) => {
                    while (listDepth > targetDepth) {
                        html += '</ul>';
                        listDepth -= 1;
                    }
                };

                for (const rawLine of lines) {
                    const line = rawLine.replace(/\t/g, '    ').trimEnd();
                    const trimmed = line.trim();

                    if (!trimmed) {
                        closeListsTo(0);
                        continue;
                    }

                    if (trimmed.startsWith('### ')) {
                        closeListsTo(0);
                        const title = trimmed.slice(4);
                        html += `<h5 class="${getMarkdownHeadingClass(title)}">${formatInlineMarkdown(title)}</h5>`;
                        continue;
                    }

                    if (trimmed.startsWith('## ')) {
                        closeListsTo(0);
                        const title = trimmed.slice(3);
                        html += `<h4 class="${getMarkdownHeadingClass(title)}">${formatInlineMarkdown(title)}</h4>`;
                        continue;
                    }

                    if (trimmed.startsWith('# ')) {
                        closeListsTo(0);
                        const title = trimmed.slice(2);
                        html += `<h3 class="${getMarkdownHeadingClass(title)}">${formatInlineMarkdown(title)}</h3>`;
                        continue;
                    }

                    const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
                    if (bulletMatch) {
                        const indentSize = bulletMatch[1].length;
                        const depth = Math.floor(indentSize / 2) + 1;
                        while (listDepth < depth) {
                            html += '<ul>';
                            listDepth += 1;
                        }
                        closeListsTo(depth);
                        const value = bulletMatch[2];
                        html += `<li>${formatInlineMarkdown(value)}</li>`;
                        continue;
                    }

                    closeListsTo(0);
                    html += `<p>${formatInlineMarkdown(trimmed)}</p>`;
                }

                closeListsTo(0);
                return html;
            }

            function getMarkdownHeadingClass(title) {
                const value = String(title || '').toLowerCase();
                if (value.includes('executive summary') || value.includes('event pattern analysis') || value.includes('recommended action')) {
                    return 'section-title-xl';
                }
                return '';
            }

            function formatInlineMarkdown(text) {
                return escapeHtml(text)
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/`([^`]+)`/g, '<code>$1</code>')
                    .replace(/\b(CRITICAL|HIGH RISK|HIGH)\b/gi, '<span class="md-critical">$1</span>')
                    .replace(/\b(MEDIUM|MODERATE)\b/gi, '<span class="md-medium">$1</span>')
                    .replace(/\b(LOW|LOW RISK|SAFE|STABLE)\b/gi, '<span class="md-low">$1</span>')
                    .replace(/\b(Recommended Actions?|Key Drivers?|Risk Factors?|Summary|Assessment|Status|Category)\s*:/gi, '<span class="md-label">$1:</span>');
            }

            function riskToSeverityClass(riskLevel) {
                const value = String(riskLevel || '').toLowerCase();
                if (value.includes('critical') || value.includes('high')) return 'severity-critical';
                if (value.includes('moderate') || value.includes('medium')) return 'severity-high';
                return 'severity-low';
            }

            function getCategoryColor(category) {
                const value = String(category || '').toLowerCase();
                if (value === 'application') return '#4c9bff';
                if (value === 'system') return '#ffb347';
                if (value === 'security') return '#2fd38a';
                return '#b0b7d5';
            }

            function escapeHtml(value) {
                return String(value)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');
            }
            restoreFromCache();
        });

