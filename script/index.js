import { createIcons } from './utils.js';
import { loadConfig as loadSharedConfig } from './configLoader.js';

// IDS Dashboard - Main Script
document.addEventListener('DOMContentLoaded', async () => {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');

    menuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('active');
    });

    function closeSidebarMenu() {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    }

    overlay.addEventListener('click', closeSidebarMenu);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            closeSidebarMenu();
        }
    });

    createIcons();

    const fetchBtn = document.getElementById('fetchBtn');
    const refreshBtn = document.getElementById('refreshBtn');

    const loadingState = document.getElementById('loadingState');
    const errorState = document.getElementById('errorState');
    const errorMessage = document.getElementById('errorMessage');
    const emptyState = document.getElementById('emptyState');
    const dataTable = document.getElementById('dataTable');
    const tableHead = document.getElementById('tableHead');
    const tableBody = document.getElementById('tableBody');
    const tableContainer = document.getElementById('tableContainer');
    const tableHeader = document.querySelector('.table-header');
    const intelDashboard = document.getElementById('intelDashboard');

    const periodSummaryBody = document.getElementById('periodSummaryBody');
    const statusCountBody = document.getElementById('statusCountBody');
    const datasetContainsBody = document.getElementById('datasetContainsBody');
    const cvssV3Legend = document.getElementById('cvssV3Legend');
    const epssPercentileLegend = document.getElementById('epssPercentileLegend');

    const cvssV3ChartCanvas = document.getElementById('cvssV3Chart');
    const epssPercentileChartCanvas = document.getElementById('epssPercentileChart');

    let cvssV3Chart = null;
    let epssPercentileChart = null;

    let config;
    try {
        config = await loadSharedConfig();
    } catch (error) {
        console.error('Unable to load config/config.json:', error);
        if (errorMessage) errorMessage.textContent = 'Unable to load configuration.';
        if (errorState) errorState.classList.remove('hidden');
        return;
    }

    const SUPABASE_URL = config.SUPABASE_URL;
    const SUPABASE_TABLE = config.SUPABASE_TABLE;
    const SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY;

    if (dataTable) {
        if (fetchBtn) fetchBtn.addEventListener('click', fetchTableData);
        if (refreshBtn) refreshBtn.addEventListener('click', fetchTableData);
        window.addEventListener('resize', adjustLayoutHeights);
        fetchTableData();
    }

    async function fetchTableData() {
        showLoading();

        try {
            if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL in config/config.json.');
            if (!SUPABASE_TABLE) throw new Error('Missing SUPABASE_TABLE in config/config.json.');
            if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'PASTE_YOUR_SUPABASE_ANON_KEY_HERE') {
                throw new Error('Missing SUPABASE_ANON_KEY in config/config.json.');
            }

            const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${SUPABASE_TABLE}?select=*`;
            const response = await fetch(endpoint, {
                method: 'GET',
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                let apiError = '';
                try {
                    const errorBody = await response.json();
                    apiError = errorBody?.message || errorBody?.error || '';
                } catch {
                    apiError = '';
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}${apiError ? ` - ${apiError}` : ''}`);
            }

            const data = await response.json();
            renderTableAndDashboard(data);
        } catch (error) {
            console.error('Fetch error:', error);
            showError(error.message);
        }
    }

    function showLoading() {
        if (emptyState) emptyState.classList.add('hidden');
        if (loadingState) loadingState.classList.remove('hidden');
        if (errorState) errorState.classList.add('hidden');
        if (dataTable) dataTable.classList.add('hidden');
    }

    function showError(message) {
        if (emptyState) emptyState.classList.add('hidden');
        if (loadingState) loadingState.classList.add('hidden');
        if (errorState) errorState.classList.remove('hidden');
        if (errorMessage) errorMessage.textContent = message || 'Failed to load data';
        if (dataTable) dataTable.classList.add('hidden');
    }

    function renderTableAndDashboard(data) {
        if (emptyState) emptyState.classList.add('hidden');
        if (loadingState) loadingState.classList.add('hidden');
        if (errorState) errorState.classList.add('hidden');
        if (dataTable) dataTable.classList.remove('hidden');

        let rows = [];
        if (Array.isArray(data)) rows = data;
        else if (typeof data === 'object' && data !== null) rows = [data];

        if (rows.length === 0) {
            showError('No data available');
            return;
        }

        renderTopDashboard(rows);
        renderDataTable(rows);
        adjustLayoutHeights();
        createIcons();
    }

    function renderDataTable(rows) {
        const displayColumns = ['cve_id', 'vendor', 'product', 'severity', 'cvss_score', 'epss_score', 'published', 'description'];
        const firstRow = rows[0];
        const columns = displayColumns.filter((col) => col in firstRow);
        if (columns.length === 0) columns.push(...Object.keys(firstRow));

        tableHead.innerHTML = `
            <tr>
                ${columns.map((col) => `<th>${formatColumnName(col)}</th>`).join('')}
            </tr>
        `;

        tableBody.innerHTML = rows.map((row) => `
            <tr>
                ${columns.map((col) => `<td>${formatCellValue(col, row[col])}</td>`).join('')}
            </tr>
        `).join('');
    }

    function renderTopDashboard(rows) {
        const periodRows = [
            ['Today', (d) => isSameDay(d, new Date())],
            ['This Week', (d) => isThisWeek(d)],
            ['This Month', (d) => isThisMonth(d)],
            ['Last Month', (d) => isLastMonth(d)],
            ['This Year', (d) => isThisYear(d)]
        ];

        periodSummaryBody.innerHTML = periodRows.map(([label, test]) => {
            const summary = summarizeRows(rows.filter((r) => {
                const dt = getRowDate(r);
                return dt ? test(dt) : false;
            }));
            return `
                <tr>
                    <td><strong>${label}</strong></td>
                    <td>${summary.total}</td>
                    <td>${summary.CRITICAL}</td>
                    <td>${summary.HIGH}</td>
                    <td>${summary.MEDIUM}</td>
                    <td>${summary.LOW}</td>
                </tr>
            `;
        }).join('');

        const cvssV3Counts = scoreSeverityCounts(rows, ['cvss_v3_score', 'cvss_score']);
        const epssPercentileBuckets = epssBucketCounts(rows, ['epss_percentile'], true);

        renderDistributionTable(cvssV3Legend, cvssV3Counts);
        renderBucketTable(epssPercentileLegend, epssPercentileBuckets);
        renderDistributionCharts(cvssV3Counts, epssPercentileBuckets);

        const uniqueCves = new Set(rows.map((r) => String(r.cve_id || '').trim()).filter(Boolean)).size;
        const withCvssV3 = rows.filter((r) => getNumber(r, ['cvss_v3_score', 'cvss_score']) !== null).length;
        const withEpss = rows.filter((r) => getNumber(r, ['epss_score']) !== null).length;
        const withEpssPercentile = rows.filter((r) => normalizeEpss(getNumber(r, ['epss_percentile']), true) !== null).length;

        statusCountBody.innerHTML = `
            <tr><td>Total Records</td><td>${rows.length}</td></tr>
            <tr><td>Unique CVE IDs</td><td>${uniqueCves}</td></tr>
            <tr><td>With CVSS V3</td><td>${withCvssV3}</td></tr>
            <tr><td>With EPSS</td><td>${withEpss}</td></tr>
            <tr><td>With EPSS Percentile</td><td>${withEpssPercentile}</td></tr>
        `;

        const vendors = rows.map((r) => String(r.vendor || '').trim()).filter(Boolean);
        const products = rows.map((r) => String(r.product || '').trim()).filter(Boolean);
        const avgV3 = average(rows.map((r) => getNumber(r, ['cvss_v3_score', 'cvss_score'])));
        const avgEpss = average(rows.map((r) => getNumber(r, ['epss_score'])));

        const dated = rows.map((r) => getRowDate(r)).filter(Boolean).sort((a, b) => a - b);
        const dateRange = dated.length > 0
            ? `${formatDate(dated[0])} - ${formatDate(dated[dated.length - 1])}`
            : '-';

        datasetContainsBody.innerHTML = `
            <tr><td>Unique Vendors</td><td>${new Set(vendors).size}</td></tr>
            <tr><td>Unique Products</td><td>${new Set(products).size}</td></tr>
            <tr><td>Average CVSS V3</td><td>${avgV3 !== null ? avgV3.toFixed(2) : '-'}</td></tr>
            <tr><td>Average EPSS</td><td>${avgEpss !== null ? `${(avgEpss * 100).toFixed(2)}%` : '-'}</td></tr>
            <tr><td>Date Range</td><td>${dateRange}</td></tr>
        `;
    }

    function renderDistributionCharts(v3, epssPercentile) {
        const labels = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
        const colors = ['#000000', '#dc2626', '#fb923c', '#fde047'];
        const bucketLabels = ['0.00-0.20', '0.20-0.40', '0.40-0.60', '0.60-0.80', '0.80-1.00'];
        const bucketColors = ['#0b3c5d', '#1f6f8b', '#4aa96c', '#f59e0b', '#dc2626'];

        if (cvssV3Chart) cvssV3Chart.destroy();
        if (epssPercentileChart) epssPercentileChart.destroy();

        cvssV3Chart = new Chart(cvssV3ChartCanvas, {
            type: 'pie',
            data: {
                labels,
                datasets: [{
                    data: labels.map((l) => v3[l]),
                    backgroundColor: colors,
                    borderColor: '#fff7ed',
                    borderWidth: 1
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });

        epssPercentileChart = new Chart(epssPercentileChartCanvas, {
            type: 'pie',
            data: {
                labels: bucketLabels,
                datasets: [{
                    data: bucketLabels.map((l) => epssPercentile[l]),
                    backgroundColor: bucketColors,
                    borderColor: '#ffffff',
                    borderWidth: 1
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }

    function renderDistributionTable(container, counts) {
        const rows = [
            ['CRITICAL', counts.CRITICAL],
            ['HIGH', counts.HIGH],
            ['MEDIUM', counts.MEDIUM],
            ['LOW', counts.LOW]
        ];

        container.innerHTML = rows.map(([label, value]) => `
            <tr>
                <td><span class="severity-chip ${chipClass(label)}">${label}</span></td>
                <td>${value}</td>
            </tr>
        `).join('');
    }

    function renderBucketTable(container, counts) {
        const rows = [
            ['0.00-0.20', counts['0.00-0.20']],
            ['0.20-0.40', counts['0.20-0.40']],
            ['0.40-0.60', counts['0.40-0.60']],
            ['0.60-0.80', counts['0.60-0.80']],
            ['0.80-1.00', counts['0.80-1.00']]
        ];

        container.innerHTML = rows.map(([label, value]) => `
            <tr>
                <td><span class="bucket-chip ${bucketClass(label)}">${label}</span></td>
                <td>${value}</td>
            </tr>
        `).join('');
    }

    function summarizeRows(rows) {
        const base = { total: rows.length, CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
        rows.forEach((row) => {
            const sev = deriveSeverity(row);
            if (base[sev] !== undefined) base[sev] += 1;
        });
        return base;
    }

    function scoreSeverityCounts(rows, scoreKeys) {
        const out = { total: 0, CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
        rows.forEach((row) => {
            const score = getNumber(row, scoreKeys);
            if (score === null) return;
            out.total += 1;
            const sev = severityFromScore(score);
            out[sev] += 1;
        });
        return out;
    }

    function deriveSeverity(row) {
        const sev = String(row.severity || '').toUpperCase();
        if (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(sev)) return sev;
        const score = getNumber(row, ['cvss_v3_score', 'cvss_score']);
        return score !== null ? severityFromScore(score) : 'LOW';
    }

    function severityFromScore(score) {
        if (score >= 9) return 'CRITICAL';
        if (score >= 7) return 'HIGH';
        if (score >= 4) return 'MEDIUM';
        return 'LOW';
    }

    function chipClass(label) {
        if (label === 'CRITICAL') return 'chip-critical';
        if (label === 'HIGH') return 'chip-high';
        if (label === 'MEDIUM') return 'chip-medium';
        if (label === 'LOW') return 'chip-low';
        return 'chip-none';
    }

    function bucketClass(label) {
        if (label === '0.00-0.20') return 'bucket-1';
        if (label === '0.20-0.40') return 'bucket-2';
        if (label === '0.40-0.60') return 'bucket-3';
        if (label === '0.60-0.80') return 'bucket-4';
        return 'bucket-5';
    }

    function epssBucketCounts(rows, keys, allowPercent) {
        const buckets = {
            '0.00-0.20': 0,
            '0.20-0.40': 0,
            '0.40-0.60': 0,
            '0.60-0.80': 0,
            '0.80-1.00': 0
        };

        rows.forEach((row) => {
            const raw = getNumber(row, keys);
            const value = normalizeEpss(raw, allowPercent);
            if (value === null) return;
            if (value < 0.2) buckets['0.00-0.20'] += 1;
            else if (value < 0.4) buckets['0.20-0.40'] += 1;
            else if (value < 0.6) buckets['0.40-0.60'] += 1;
            else if (value < 0.8) buckets['0.60-0.80'] += 1;
            else buckets['0.80-1.00'] += 1;
        });

        return buckets;
    }

    function normalizeEpss(value, allowPercent) {
        if (value === null || value === undefined || Number.isNaN(value)) return null;
        let out = Number(value);
        if (!Number.isFinite(out)) return null;
        if (allowPercent && out > 1) out = out / 100;
        if (out < 0 || out > 1) return null;
        return out;
    }

    function getNumber(row, keys) {
        for (const key of keys) {
            const value = row[key];
            if (value === null || value === undefined || value === '') continue;
            const num = Number(value);
            if (!Number.isNaN(num)) return num;
        }
        return null;
    }

    function getRowDate(row) {
        const raw = row.published || row.published_date || row.date || row.created_at || row.updated;
        if (!raw) return null;
        const date = new Date(raw);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function isSameDay(a, b) {
        return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }

    function isThisWeek(date) {
        const now = new Date();
        const day = now.getDay();
        const start = new Date(now);
        start.setDate(now.getDate() - day);
        start.setHours(0, 0, 0, 0);
        return date >= start && isThisYear(date);
    }

    function isThisMonth(date) {
        const now = new Date();
        return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    }

    function isLastMonth(date) {
        const now = new Date();
        const target = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return date.getFullYear() === target.getFullYear() && date.getMonth() === target.getMonth();
    }

    function isThisYear(date) {
        return date.getFullYear() === new Date().getFullYear();
    }

    function average(arr) {
        const valid = arr.filter((n) => typeof n === 'number' && Number.isFinite(n));
        if (valid.length === 0) return null;
        return valid.reduce((sum, n) => sum + n, 0) / valid.length;
    }

    function adjustLayoutHeights() {
        if (!tableContainer) return;
        const vh = window.innerHeight;
        const headerHeight = tableHeader ? tableHeader.offsetHeight : 0;
        const dashboardHeight = intelDashboard ? intelDashboard.offsetHeight : 0;
        const verticalPadding = 170;
        const maxHeight = Math.max(220, vh - headerHeight - dashboardHeight - verticalPadding);
        tableContainer.style.maxHeight = `${maxHeight}px`;

        if (cvssV3Chart) cvssV3Chart.resize();
        if (epssPercentileChart) epssPercentileChart.resize();
    }

    function formatColumnName(name) {
        const columnNames = {
            cve_id: 'CVE ID',
            cvss_score: 'CVSS',
            cvss_v3_score: 'CVSS V3',
            epss_score: 'EPSS',
            epss_percentile: 'EPSS %',
            published: 'Published',
            updated: 'Updated',
            vendor: 'Vendor',
            product: 'Product',
            severity: 'Severity',
            description: 'Description'
        };

        if (columnNames[name]) return columnNames[name];

        return name
            .replace(/_/g, ' ')
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, (str) => str.toUpperCase())
            .trim();
    }

    function formatCellValue(column, value) {
        if (value === null || value === undefined) return '-';

        switch (column) {
            case 'severity':
                return `<span class="severity-badge ${getSeverityClass(value)}">${value}</span>`;

            case 'cvss_score':
            case 'cvss_v3_score': {
                const score = Number(value);
                const cvssClass = score >= 9 ? 'cvss-critical' : score >= 7 ? 'cvss-high' : score >= 4 ? 'cvss-medium' : 'cvss-low';
                return `<span class="cvss-badge ${cvssClass}">${value}</span>`;
            }

            case 'epss_score':
                return (Number(value) * 100).toFixed(2) + '%';

            case 'epss_percentile':
                return (Number(value) * 100).toFixed(1) + '%';

            case 'published':
            case 'updated':
            case 'created_at':
                return formatDate(value);

            case 'description': {
                const maxLen = 80;
                const desc = String(value);
                return desc.length > maxLen
                    ? `<span title="${desc.replace(/"/g, '&quot;')}">${desc.substring(0, maxLen)}...</span>`
                    : desc;
            }

            case 'cve_id':
                return `<a href="https://nvd.nist.gov/vuln/detail/${value}" target="_blank" class="cve-link">${value}</a>`;

            default:
                if (typeof value === 'boolean') return value ? '&#10003;' : '&#10007;';
                if (typeof value === 'object') return JSON.stringify(value);
                return String(value);
        }
    }

    function getSeverityClass(severity) {
        const sev = String(severity).toUpperCase();
        if (sev === 'CRITICAL') return 'severity-critical';
        if (sev === 'HIGH') return 'severity-high';
        if (sev === 'MEDIUM') return 'severity-medium';
        if (sev === 'LOW') return 'severity-low';
        return 'severity-none';
    }

    function formatDate(dateStr) {
        try {
            const date = dateStr instanceof Date ? dateStr : new Date(dateStr);
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch {
            return String(dateStr);
        }
    }

});



