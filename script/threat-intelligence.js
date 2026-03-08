import { initSidebarMenu, createIcons } from './utils.js';
import { loadConfig as loadSharedConfig } from './configLoader.js';
import { buildWebhookRequest } from './session-context.js';
import { getPageCache, setPageCache, clearPageCache } from './cache-store.js';

async function loadConfig() {
    return loadSharedConfig();
}

// Threat Intelligence Page Scripts
        document.addEventListener('DOMContentLoaded', async function () {
    let config;
    try {
        config = await loadConfig();
    } catch (error) {
        console.error('Unable to initialize Threat Intelligence page:', error);
        return;
    }
    const threat_webhook = config.THREAT_WEBHOOK_URL;
    if (!threat_webhook) {
        console.error('Missing THREAT_WEBHOOK_URL in config/config.json');
        return;
    }
    initSidebarMenu();
            const copyBtn = document.getElementById('copyBtn');
            const commandText = document.getElementById('commandText');
            const uploadArea = document.getElementById('uploadArea');
            const jsonFileInput = document.getElementById('jsonFileInput');
            const fileInfo = document.getElementById('fileInfo');
            const fileName = document.getElementById('fileName');
            const removeFile = document.getElementById('removeFile');
            const analyzeBtn = document.getElementById('analyzeBtn');
            const resultsCard = document.getElementById('resultsCard');
            const resultsContent = document.getElementById('resultsContent');

            let uploadedData = null;
            const cacheKey = 'threat-intelligence';

            // Copy command to clipboard
            if (copyBtn) {
                copyBtn.addEventListener('click', async () => {
                    try {
                        await navigator.clipboard.writeText(commandText.textContent);
                        copyBtn.innerHTML = '<i data-lucide="check"></i>';
                        createIcons();
                        setTimeout(() => {
                            copyBtn.innerHTML = '<i data-lucide="copy"></i>';
                            createIcons();
                        }, 2000);
                    } catch (err) {
                        console.error('Failed to copy:', err);
                    }
                });
            }

            // Upload area click
            if (uploadArea) {
                uploadArea.addEventListener('click', () => jsonFileInput.click());

                // Drag and drop
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
                    if (file && file.type === 'application/json') {
                        handleFile(file);
                    }
                });
            }

            // File input change
            if (jsonFileInput) {
                jsonFileInput.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (file) handleFile(file);
                });
            }

            // Remove file
            if (removeFile) {
                removeFile.addEventListener('click', () => {
                    resetUpload();
                });
            }

            // Analyze button - POST to n8n webhook
            if (analyzeBtn) {
                analyzeBtn.addEventListener('click', async () => {
                    if (uploadedData) {
                        // Show loading state
                        analyzeBtn.disabled = true;
                        analyzeBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Analyzing...';
                        createIcons();

                        try {
                            const request = buildWebhookRequest(threat_webhook, uploadedData, { method: 'POST' });
                            const response = await fetch(request.url, request.options);

                            if (!response.ok) {
                                throw new Error(`HTTP error! status: ${response.status}`);
                            }

                            const responseData = await response.json();
                            displayResults(responseData);
                            setPageCache(cacheKey, {
                                fileName: fileName.textContent || '',
                                uploadedData,
                                resultData: responseData
                            });
                        } catch (error) {
                            console.error('Error posting to webhook:', error);
                            resultsCard.classList.remove('hidden');
                            resultsContent.innerHTML = `
                                <div class="error-message">
                                    <i data-lucide="alert-triangle"></i>
                                    <p><strong>Error:</strong> Failed to analyze data. ${error.message}</p>
                                    <p class="hint">Make sure the webhook workflow is running and reachable.</p>
                                </div>
                            `;
                            createIcons();
                        } finally {
                            // Reset button state
                            analyzeBtn.disabled = false;
                            analyzeBtn.innerHTML = '<i data-lucide="search"></i> Analyze Data';
                            createIcons();
                        }
                    }
                });
            }

            function handleFile(file) {
                fileName.textContent = file.name;
                uploadArea.classList.add('hidden');
                fileInfo.classList.remove('hidden');
                analyzeBtn.classList.remove('hidden');

                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        uploadedData = JSON.parse(e.target.result);
                    } catch (err) {
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
                resultsCard.classList.remove('hidden');

                // Handle array response (webhook typically returns array)
                const report = Array.isArray(data) ? data[0] : data;

                // Check if it's our threat intelligence format
                if (report && report.summary && report.software) {
                    resultsContent.innerHTML = renderThreatReport(report);
                    // Render charts after HTML is inserted
                    setTimeout(() => renderCharts(report), 100);
                } else if (Array.isArray(data)) {
                    // Fallback for generic array data
                    let html = `<p class="result-count">Found ${data.length} entries</p>`;
                    html += '<div class="results-table-container"><table class="data-table">';
                    if (data.length > 0) {
                        const cols = Object.keys(data[0]);
                        html += '<thead><tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr></thead>';
                        html += '<tbody>' + data.map(row =>
                            '<tr>' + cols.map(c => `<td>${formatValue(row[c])}</td>`).join('') + '</tr>'
                        ).join('') + '</tbody>';
                    }
                    html += '</table></div>';
                    resultsContent.innerHTML = html;
                } else {
                    // Fallback for other object data
                    resultsContent.innerHTML = '<div class="json-display"><pre>' + JSON.stringify(data, null, 2) + '</pre></div>';
                }

                createIcons();
                resultsCard.scrollIntoView({ behavior: 'smooth' });
            }

            function renderThreatReport(report) {
                const { summary, software, generated_at } = report;

                // Format timestamp
                const reportDate = new Date(generated_at).toLocaleString();

                // Get risk levels from summary
                const systemRisk = extractRisk(summary.system);
                const securityRisk = extractRisk(summary.security);
                const networkRisk = extractRisk(summary.network);

                return `
                    <div class="report-header">
                        <span class="report-timestamp"><i data-lucide="clock"></i> Generated: ${reportDate}</span>
                    </div>

                    <!-- Risk Overview Cards -->
                    <div class="risk-overview">
                        <div class="risk-card ${systemRisk.class}">
                            <div class="risk-icon"><i data-lucide="monitor"></i></div>
                            <div class="risk-info">
                                <span class="risk-label">System</span>
                                <span class="risk-level">${systemRisk.level}</span>
                            </div>
                        </div>
                        <div class="risk-card ${securityRisk.class}">
                            <div class="risk-icon"><i data-lucide="shield-check"></i></div>
                            <div class="risk-info">
                                <span class="risk-label">Security</span>
                                <span class="risk-level">${securityRisk.level}</span>
                            </div>
                        </div>
                        <div class="risk-card ${networkRisk.class}">
                            <div class="risk-icon"><i data-lucide="network"></i></div>
                            <div class="risk-info">
                                <span class="risk-label">Network</span>
                                <span class="risk-level">${networkRisk.level}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Pie Charts Section -->
                    <div class="charts-section">
                        <h3><i data-lucide="pie-chart"></i> Risk Analysis Charts</h3>
                        <div class="charts-grid">
                            <div class="chart-card">
                                <h4>System Risk Distribution</h4>
                                <div class="chart-container">
                                    <canvas id="riskPieChart"></canvas>
                                </div>
                            </div>
                            <div class="chart-card">
                                <h4>Software Vulnerability Breakdown</h4>
                                <div class="chart-container">
                                    <canvas id="softwarePieChart"></canvas>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Summary Sections -->
                    <div class="summary-sections">
                        ${renderSummarySection('System Analysis', 'monitor', summary.system, systemRisk.class)}
                        ${renderSummarySection('Security Status', 'shield-check', summary.security, securityRisk.class)}
                    </div>

                    <!-- Software Graph -->
                    <div class="charts-section">
                        <h3><i data-lucide="bar-chart-3"></i> Software Risk Graph</h3>
                        <div class="charts-grid single">
                            <div class="chart-card wide">
                                <h4>Software Risk Distribution</h4>
                                <div class="chart-container bar-chart">
                                    <canvas id="softwareBarChart"></canvas>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Software Details -->
                    <div class="software-section">
                        <h3><i data-lucide="package"></i> Installed Software Analysis</h3>
                        <div class="software-stats">
                            <div class="stat-item">
                                <span class="stat-value">${software.total}</span>
                                <span class="stat-label">Total Scanned</span>
                            </div>
                            <div class="stat-item critical">
                                <span class="stat-value">${software.critical}</span>
                                <span class="stat-label">Critical</span>
                            </div>
                            <div class="stat-item high">
                                <span class="stat-value">${software.high}</span>
                                <span class="stat-label">High Risk</span>
                            </div>
                        </div>
                        <div class="results-table-container">
                            <table class="data-table software-table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Software</th>
                                        <th>Version</th>
                                        <th>Publisher</th>
                                        <th>CVEs</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${software.items.map(item => `
                                        <tr>
                                            <td>${item.s_no}</td>
                                            <td><strong>${item.name}</strong></td>
                                            <td><code>${item.version}</code></td>
                                            <td>${item.publisher}</td>
                                            <td>${item.cveCount > 0 ? `<span class="cve-count">${item.cveCount}</span>` : '0'}</td>
                                            <td><span class="severity-badge ${getSeverityClass(item.severity)}">${item.severity}</span></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Network Ports Graph -->
                    <div class="charts-section">
                        <h3><i data-lucide="activity"></i> Network Ports Graph</h3>
                        <div class="charts-grid single">
                            <div class="chart-card wide">
                                <h4>Open Network Ports</h4>
                                <div class="chart-container bar-chart">
                                    <canvas id="networkPortsChart"></canvas>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Network Summary -->
                    <div class="summary-sections">
                        ${renderSummarySection('Network Exposure', 'network', summary.network, networkRisk.class)}
                    </div>
                `;
            }

            // Store chart instances to destroy before creating new ones
            let riskPieChartInstance = null;
            let softwarePieChartInstance = null;
            let softwareBarChartInstance = null;
            let networkPortsChartInstance = null;

            function renderCharts(report) {
                const { summary, software } = report;

                // Get risk levels
                const systemRisk = extractRisk(summary.system);
                const securityRisk = extractRisk(summary.security);
                const networkRisk = extractRisk(summary.network);

                // Count risk types for pie chart
                const riskCounts = { 'High Risk': 0, 'Low Risk': 0, 'Secure': 0, 'Medium': 0 };
                [systemRisk, securityRisk, networkRisk].forEach(r => {
                    if (riskCounts.hasOwnProperty(r.level)) {
                        riskCounts[r.level]++;
                    }
                });

                // Count software severity types
                const severityCounts = { 'CRITICAL': 0, 'HIGH': 0, 'MEDIUM': 0, 'LOW': 0, 'NO KNOWN RISK': 0 };
                software.items.forEach(item => {
                    if (item.severity.includes('CRITICAL')) severityCounts['CRITICAL']++;
                    else if (item.severity.includes('HIGH')) severityCounts['HIGH']++;
                    else if (item.severity.includes('MEDIUM')) severityCounts['MEDIUM']++;
                    else if (item.severity.includes('LOW')) severityCounts['LOW']++;
                    else severityCounts['NO KNOWN RISK']++;
                });

                // Destroy existing charts
                if (riskPieChartInstance) riskPieChartInstance.destroy();
                if (softwarePieChartInstance) softwarePieChartInstance.destroy();
                if (softwareBarChartInstance) softwareBarChartInstance.destroy();
                if (networkPortsChartInstance) networkPortsChartInstance.destroy();

                // Chart.js default options for dark theme
                const darkThemeDefaults = {
                    color: '#94a3b8',
                    borderColor: 'rgba(255, 255, 255, 0.1)'
                };

                // Risk Pie Chart
                const riskPieCtx = document.getElementById('riskPieChart');
                if (riskPieCtx) {
                    riskPieChartInstance = new Chart(riskPieCtx, {
                        type: 'doughnut',
                        data: {
                            labels: ['High Risk', 'Medium', 'Low Risk', 'Secure'],
                            datasets: [{
                                data: [riskCounts['High Risk'], riskCounts['Medium'], riskCounts['Low Risk'], riskCounts['Secure']],
                                backgroundColor: [
                                    'rgba(239, 68, 68, 0.8)',
                                    'rgba(245, 158, 11, 0.8)',
                                    'rgba(59, 130, 246, 0.8)',
                                    'rgba(16, 185, 129, 0.8)'
                                ],
                                borderColor: [
                                    'rgba(239, 68, 68, 1)',
                                    'rgba(245, 158, 11, 1)',
                                    'rgba(59, 130, 246, 1)',
                                    'rgba(16, 185, 129, 1)'
                                ],
                                borderWidth: 2
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: {
                                    position: 'bottom',
                                    labels: { color: '#f8fafc', padding: 15, font: { family: 'Outfit' } }
                                }
                            }
                        }
                    });
                }

                // Software Pie Chart
                const softwarePieCtx = document.getElementById('softwarePieChart');
                if (softwarePieCtx) {
                    softwarePieChartInstance = new Chart(softwarePieCtx, {
                        type: 'doughnut',
                        data: {
                            labels: ['Critical', 'High', 'Medium', 'Low', 'No Known Risk'],
                            datasets: [{
                                data: [
                                    severityCounts['CRITICAL'],
                                    severityCounts['HIGH'],
                                    severityCounts['MEDIUM'],
                                    severityCounts['LOW'],
                                    severityCounts['NO KNOWN RISK']
                                ],
                                backgroundColor: [
                                    'rgba(239, 68, 68, 0.8)',
                                    'rgba(245, 158, 11, 0.8)',
                                    'rgba(234, 179, 8, 0.8)',
                                    'rgba(59, 130, 246, 0.8)',
                                    'rgba(16, 185, 129, 0.8)'
                                ],
                                borderColor: [
                                    'rgba(239, 68, 68, 1)',
                                    'rgba(245, 158, 11, 1)',
                                    'rgba(234, 179, 8, 1)',
                                    'rgba(59, 130, 246, 1)',
                                    'rgba(16, 185, 129, 1)'
                                ],
                                borderWidth: 2
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: {
                                    position: 'bottom',
                                    labels: { color: '#f8fafc', padding: 15, font: { family: 'Outfit' } }
                                }
                            }
                        }
                    });
                }

                // Software Bar Chart
                const softwareBarCtx = document.getElementById('softwareBarChart');
                if (softwareBarCtx) {
                    softwareBarChartInstance = new Chart(softwareBarCtx, {
                        type: 'bar',
                        data: {
                            labels: ['Critical', 'High', 'Medium', 'Low', 'No Known Risk'],
                            datasets: [{
                                label: 'Number of Software',
                                data: [
                                    severityCounts['CRITICAL'],
                                    severityCounts['HIGH'],
                                    severityCounts['MEDIUM'],
                                    severityCounts['LOW'],
                                    severityCounts['NO KNOWN RISK']
                                ],
                                backgroundColor: [
                                    'rgba(239, 68, 68, 0.7)',
                                    'rgba(245, 158, 11, 0.7)',
                                    'rgba(234, 179, 8, 0.7)',
                                    'rgba(59, 130, 246, 0.7)',
                                    'rgba(16, 185, 129, 0.7)'
                                ],
                                borderColor: [
                                    'rgba(239, 68, 68, 1)',
                                    'rgba(245, 158, 11, 1)',
                                    'rgba(234, 179, 8, 1)',
                                    'rgba(59, 130, 246, 1)',
                                    'rgba(16, 185, 129, 1)'
                                ],
                                borderWidth: 2,
                                borderRadius: 8
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: { display: false }
                            },
                            scales: {
                                y: {
                                    beginAtZero: true,
                                    ticks: { color: '#94a3b8', stepSize: 1 },
                                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                                },
                                x: {
                                    ticks: { color: '#94a3b8' },
                                    grid: { display: false }
                                }
                            }
                        }
                    });
                }

                // Network Ports Bar Chart
                const networkPortData = extractNetworkPortData(report);
                const networkPortsCtx = document.getElementById('networkPortsChart');
                if (networkPortsCtx) {
                    networkPortsChartInstance = new Chart(networkPortsCtx, {
                        type: 'bar',
                        data: {
                            labels: networkPortData.labels,
                            datasets: [{
                                label: 'Occurrences',
                                data: networkPortData.values,
                                backgroundColor: 'rgba(59, 130, 246, 0.7)',
                                borderColor: 'rgba(59, 130, 246, 1)',
                                borderWidth: 2,
                                borderRadius: 8
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: { display: false }
                            },
                            scales: {
                                y: {
                                    beginAtZero: true,
                                    ticks: { color: '#94a3b8', stepSize: 1 },
                                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                                },
                                x: {
                                    ticks: { color: '#94a3b8' },
                                    grid: { display: false }
                                }
                            }
                        }
                    });
                }
            }

            function extractNetworkPortData(report) {
                const portCounts = {};
                const addPort = (rawPort) => {
                    const port = Number(rawPort);
                    if (!Number.isInteger(port) || port < 1 || port > 65535) return;
                    const key = String(port);
                    portCounts[key] = (portCounts[key] || 0) + 1;
                };

                const explicitPortLists = [];
                if (Array.isArray(report.network_ports)) explicitPortLists.push(report.network_ports);
                if (Array.isArray(report.open_ports)) explicitPortLists.push(report.open_ports);

                explicitPortLists.forEach((ports) => {
                    ports.forEach((entry) => {
                        if (typeof entry === 'number' || typeof entry === 'string') {
                            addPort(entry);
                            return;
                        }
                        if (entry && typeof entry === 'object') {
                            addPort(entry.port ?? entry.port_number ?? entry.number);
                        }
                    });
                });

                const summaryNetwork = Array.isArray(report?.summary?.network) ? report.summary.network : [];
                summaryNetwork.forEach((line) => {
                    const matches = String(line).match(/\b\d{1,5}\b/g) || [];
                    matches.forEach(addPort);
                });

                const sorted = Object.entries(portCounts)
                    .sort((a, b) => Number(a[0]) - Number(b[0]))
                    .slice(0, 12);

                if (!sorted.length) {
                    return { labels: ['No Port Data'], values: [0] };
                }

                return {
                    labels: sorted.map(([port]) => `Port ${port}`),
                    values: sorted.map(([, count]) => count)
                };
            }

            function renderSummarySection(title, icon, items, riskClass) {
                // Filter out risk and recommendation lines for cleaner display
                const findings = items.filter(item =>
                    !item.toLowerCase().includes('overall') &&
                    !item.toLowerCase().includes('recommended action')
                );
                const riskLine = items.find(item => item.toLowerCase().includes('overall'));
                const actionLine = items.find(item => item.toLowerCase().includes('recommended action'));

                return `
                    <div class="summary-card ${riskClass}">
                        <h4><i data-lucide="${icon}"></i> ${title}</h4>
                        <ul class="findings-list">
                            ${findings.map(f => `<li><i data-lucide="check-circle"></i> ${f}</li>`).join('')}
                        </ul>
                        ${actionLine ? `<div class="action-item"><i data-lucide="lightbulb"></i> ${actionLine}</div>` : ''}
                    </div>
                `;
            }

            function extractRisk(summaryArray) {
                const riskLine = summaryArray.find(item => item.toLowerCase().includes('overall') && item.toLowerCase().includes('risk'));
                if (!riskLine) return { level: 'Unknown', class: 'risk-unknown' };

                if (riskLine.includes('HIGH')) return { level: 'High Risk', class: 'risk-high' };
                if (riskLine.includes('LOW')) return { level: 'Low Risk', class: 'risk-low' };
                if (riskLine.includes('NO KNOWN')) return { level: 'Secure', class: 'risk-none' };
                return { level: 'Medium', class: 'risk-medium' };
            }

            function getSeverityClass(severity) {
                if (severity.includes('CRITICAL')) return 'severity-critical';
                if (severity.includes('HIGH')) return 'severity-high';
                if (severity.includes('MEDIUM')) return 'severity-medium';
                if (severity.includes('LOW')) return 'severity-low';
                return 'severity-none';
            }

            function formatValue(val) {
                if (val === null || val === undefined) return '-';
                if (typeof val === 'boolean') return val ? '✓' : '✗';
                if (typeof val === 'object') return JSON.stringify(val);
                return String(val);
            }
            restoreFromCache();
        });

