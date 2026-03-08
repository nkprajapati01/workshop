import { initSidebarMenu, createIcons } from './utils.js';
import { loadConfig as loadSharedConfig } from './configLoader.js';
import { buildWebhookRequest } from './session-context.js';
import { getPageCache, setPageCache, clearPageCache } from './cache-store.js';

async function loadConfig() {
    return loadSharedConfig();
}

// Network Intelligence Page Scripts
document.addEventListener('DOMContentLoaded', async () => {
    initSidebarMenu();

    let config = {};
    try {
        config = await loadConfig();
    } catch (error) {
        console.error('Unable to load config/config.json for Network Intelligence:', error);
    }

    const networkWebhook = config.NETWORK_WEBHOOK_URL;
    if (!networkWebhook) {
        console.error('Missing NETWORK_WEBHOOK_URL in config/config.json');
        return;
    }

    const uploadArea = document.getElementById('niUploadArea');
    const fileInput = document.getElementById('niFileInput');
    const fileInfo = document.getElementById('niFileInfo');
    const fileName = document.getElementById('niFileName');
    const removeFile = document.getElementById('niRemoveFile');
    const analyzeBtn = document.getElementById('niAnalyzeBtn');
    const resultsArea = document.getElementById('niResultsArea');

    // Guard: only run on Network Intelligence page
    if (!uploadArea) return;

    let uploadedData = null;
    let arpChartInstance = null;
    let protocolChartInstance = null;
    let burstChartInstance = null;
    let asymmetryChartInstance = null;
    let geoMapInstance = null;
    const cacheKey = 'network-intelligence';

    // --- Upload Handlers ---
    uploadArea.addEventListener('click', () => fileInput.click());

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

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFile(file);
    });

    removeFile.addEventListener('click', () => {
        resetUpload();
    });

    // --- Analyze Button ---
    analyzeBtn.addEventListener('click', async () => {
        if (!uploadedData) return;

        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Analyzing...';
        createIcons();

        try {
            const request = buildWebhookRequest(networkWebhook, uploadedData, { method: 'POST' });
            const response = await fetch(request.url, request.options);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const responseData = await response.json();
            const data = Array.isArray(responseData) ? responseData[0] : responseData;
            renderResults(data);
            setPageCache(cacheKey, {
                fileName: fileName.textContent || '',
                uploadedData,
                resultData: data
            });
        } catch (error) {
            console.error('Error posting to webhook:', error);
            resultsArea.classList.remove('hidden');
            resultsArea.innerHTML = `
                <div class="content-card">
                    <div class="error-message">
                        <i data-lucide="alert-triangle"></i>
                        <p><strong>Error:</strong> Failed to analyze network data. ${error.message}</p>
                        <p class="hint">Make sure your n8n workflow is running and reachable at ${networkWebhook}</p>
                    </div>
                </div>
            `;
            createIcons();
        } finally {
            analyzeBtn.disabled = false;
            analyzeBtn.innerHTML = '<i data-lucide="search"></i> Analyze Network Data';
            createIcons();
        }
    });

    // --- File Handling ---
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
        fileInput.value = '';
        uploadArea.classList.remove('hidden');
        fileInfo.classList.add('hidden');
        analyzeBtn.classList.add('hidden');
        resultsArea.classList.add('hidden');
        clearPageCache(cacheKey);
    }

    function restoreFromCache() {
        const cached = getPageCache(cacheKey);
        if (!cached || !cached.resultData) return;

        uploadedData = cached.uploadedData || null;
        fileName.textContent = cached.fileName || 'Restored session data';
        uploadArea.classList.add('hidden');
        fileInfo.classList.remove('hidden');
        analyzeBtn.classList.remove('hidden');
        renderResults(cached.resultData);
    }

    // --- Render All Results ---
    function renderResults(data) {
        resultsArea.classList.remove('hidden');
        // Restore the original results HTML structure if it was replaced by error
        restoreResultsStructure();

        renderStats(data);
        renderTopology(data);
        renderIpGeoMap(data);
        renderArpAnalysis(data);
        renderPortDistribution(data);
        renderBurstDetection(data);

        createIcons();
        document.getElementById('niStatsCard').scrollIntoView({ behavior: 'smooth' });
    }

    restoreFromCache();

    function restoreResultsStructure() {
        // If results area was replaced with error HTML, rebuild it
        if (!document.getElementById('niStatsCard')) {
            resultsArea.innerHTML = `
                <div class="content-card" id="niStatsCard">
                    <h2><i data-lucide="bar-chart-3"></i> Traffic Summary</h2>
                    <div class="ni-stats-grid" id="niStatsGrid"></div>
                </div>
                <div class="content-card" id="niTopologyCard">
                    <h2><i data-lucide="git-branch"></i> Network Topology</h2>
                    <div class="ni-topology-legend">
                        <span class="ni-legend-item"><span class="ni-legend-dot" style="background:#10b981;"></span>Internal IP</span>
                        <span class="ni-legend-item"><span class="ni-legend-dot" style="background:#3b82f6;"></span>External IP</span>
                        <span class="ni-legend-item"><span class="ni-legend-dot" style="background:#ef4444;"></span>Top Talker</span>
                        <span class="ni-legend-item"><span class="ni-legend-dot" style="background:#f59e0b;"></span>High Traffic</span>
                    </div>
                    <div class="ni-topology-container" id="niTopologyGraph"></div>
                </div>
                <div class="content-card" id="niGeoCard">
                    <h2><i data-lucide="map-pinned"></i> IP Geolocation Map</h2>
                    <p class="hint">External IPs are geolocated. Internal IPs are plotted near your local network region (approximate). Top talker is highlighted in red.</p>
                    <div class="ni-geo-summary" id="niGeoSummary"></div>
                    <div class="ni-geo-map" id="niGeoMap"></div>
                </div>
                <div class="content-card" id="niArpCard">
                    <h2><i data-lucide="shield-alert"></i> ARP Deep Analysis</h2>
                    <div class="ni-arp-alerts" id="niArpAlerts"></div>
                    <div class="ni-arp-stats" id="niArpStats"></div>
                    <div class="ni-chart-wrapper">
                        <h4>ARP Activity Timeline</h4>
                        <div class="chart-container"><canvas id="niArpChart"></canvas></div>
                    </div>
                </div>
                <div class="content-card" id="niPortCard">
                    <h2><i data-lucide="pie-chart"></i> Port & Protocol Distribution</h2>
                    <div class="ni-protocol-grid">
                        <div class="ni-protocol-chart-wrap">
                            <h4>Protocol Breakdown</h4>
                            <div class="chart-container"><canvas id="niProtocolChart"></canvas></div>
                        </div>
                        <div class="ni-port-table-wrap">
                            <h4>Top 10 Destination Ports</h4>
                            <div class="results-table-container">
                                <table class="data-table" id="niPortTable">
                                    <thead><tr><th>#</th><th>Port</th><th>Packets</th><th>Percentage</th></tr></thead>
                                    <tbody id="niPortTableBody"></tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="content-card" id="niBurstCard">
                    <h2><i data-lucide="zap"></i> Time-Series Traffic Burst Detection</h2>
                    <div class="ni-burst-alerts" id="niBurstAlerts"></div>
                    <div class="ni-burst-stats" id="niBurstStats"></div>
                    <div class="ni-protocol-grid">
                        <div class="ni-chart-wrapper">
                            <h4>Packets Per Second</h4>
                            <div class="chart-container"><canvas id="niBurstChart"></canvas></div>
                        </div>
                        <div class="ni-chart-wrapper">
                            <h4>Traffic Asymmetry (Src vs Dst)</h4>
                            <div class="chart-container"><canvas id="niAsymmetryChart"></canvas></div>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    // --- Stats Cards ---
    function renderStats(data) {
        const grid = document.getElementById('niStatsGrid');
        const totalPackets = data.totalPackets || 0;
        const topSource = data.topSource || 'N/A';
        const arpReqs = data.arpAnalysis ? data.arpAnalysis.arpRequests : 0;
        const arpReps = data.arpAnalysis ? data.arpAnalysis.arpReplies : 0;

        grid.innerHTML = `
            <div class="ni-stat-card">
                <div class="ni-stat-icon blue"><i data-lucide="activity"></i></div>
                <div class="ni-stat-value">${totalPackets.toLocaleString()}</div>
                <div class="ni-stat-label">Total Packets</div>
            </div>
            <div class="ni-stat-card">
                <div class="ni-stat-icon red"><i data-lucide="crosshair"></i></div>
                <div class="ni-stat-value" style="font-size:${topSource.length > 14 ? '1rem' : '1.5rem'}">${topSource}</div>
                <div class="ni-stat-label">Top Source IP</div>
            </div>
            <div class="ni-stat-card">
                <div class="ni-stat-icon orange"><i data-lucide="arrow-up-right"></i></div>
                <div class="ni-stat-value">${arpReqs.toLocaleString()}</div>
                <div class="ni-stat-label">ARP Requests</div>
            </div>
            <div class="ni-stat-card">
                <div class="ni-stat-icon green"><i data-lucide="arrow-down-left"></i></div>
                <div class="ni-stat-value">${arpReps.toLocaleString()}</div>
                <div class="ni-stat-label">ARP Replies</div>
            </div>
        `;
    }

    // --- Network Topology ---
    function renderTopology(data) {
        const container = document.getElementById('niTopologyGraph');
        if (!data.topology || !container) return;

        const topSource = data.topSource;
        const maxEdgeValue = Math.max(...data.topology.edges.map(e => e.value), 1);

        // Build vis.js nodes
        const nodes = new vis.DataSet(
            data.topology.nodes.map(node => {
                let color, borderColor, fontColor;

                if (node.id === topSource) {
                    color = 'rgba(239, 68, 68, 0.8)';
                    borderColor = '#ef4444';
                    fontColor = '#fca5a5';
                } else if (node.group === 'internal') {
                    color = 'rgba(16, 185, 129, 0.8)';
                    borderColor = '#10b981';
                    fontColor = '#6ee7b7';
                } else {
                    color = 'rgba(59, 130, 246, 0.8)';
                    borderColor = '#3b82f6';
                    fontColor = '#93c5fd';
                }

                return {
                    id: node.id,
                    label: node.label,
                    color: {
                        background: color,
                        border: borderColor,
                        highlight: { background: borderColor, border: '#fff' }
                    },
                    font: { color: fontColor, size: 11, face: 'Outfit' },
                    shape: 'dot',
                    size: node.id === topSource ? 24 : 16,
                    borderWidth: 2
                };
            })
        );

        // Build vis.js edges
        const edges = new vis.DataSet(
            data.topology.edges.map(edge => {
                const ratio = edge.value / maxEdgeValue;
                const isHigh = ratio > 0.6;
                return {
                    from: edge.from,
                    to: edge.to,
                    value: edge.value,
                    width: 1 + ratio * 5,
                    color: {
                        color: isHigh ? 'rgba(245, 158, 11, 0.6)' : 'rgba(148, 163, 184, 0.3)',
                        highlight: isHigh ? '#f59e0b' : '#94a3b8'
                    },
                    arrows: { to: { enabled: true, scaleFactor: 0.5 } },
                    smooth: { type: 'curvedCW', roundness: 0.2 },
                    title: `${edge.from} → ${edge.to}\nPackets: ${edge.value}`
                };
            })
        );

        const options = {
            physics: {
                solver: 'forceAtlas2Based',
                forceAtlas2Based: {
                    gravitationalConstant: -40,
                    centralGravity: 0.01,
                    springLength: 150,
                    springConstant: 0.04
                },
                stabilization: { iterations: 150 }
            },
            interaction: {
                hover: true,
                tooltipDelay: 200
            },
            nodes: {
                shadow: {
                    enabled: true,
                    color: 'rgba(0,0,0,0.3)',
                    size: 8
                }
            }
        };

        new vis.Network(container, { nodes, edges }, options);
    }

    // --- IP Geolocation Map ---
    async function renderIpGeoMap(data) {
        const mapContainer = document.getElementById('niGeoMap');
        const summaryContainer = document.getElementById('niGeoSummary');
        if (!mapContainer || !summaryContainer || !data.topology || !Array.isArray(data.topology.nodes)) return;
        if (typeof L === 'undefined') {
            summaryContainer.textContent = 'Map library failed to load. Check internet/CDN access and reload.';
            mapContainer.innerHTML = '';
            return;
        }

        summaryContainer.textContent = 'Resolving locations for internal/external IPs...';

        const topSource = data.topSource || '';
        const edges = Array.isArray(data.topology.edges) ? data.topology.edges : [];
        const allNodes = data.topology.nodes || [];

        const internalIps = [...new Set(allNodes.filter(n => n.group === 'internal').map(n => n.id))].slice(0, 80);
        const externalIps = [...new Set(allNodes.filter(n => n.group === 'external' && isPublicIp(n.id)).map(n => n.id))].slice(0, 80);

        if (geoMapInstance) {
            geoMapInstance.remove();
            geoMapInstance = null;
        }

        geoMapInstance = L.map(mapContainer, {
            zoomControl: true,
            worldCopyJump: true
        }).setView([20, 0], 2);

        // Classic styled world basemap.
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 8,
            attribution: 'Tiles &copy; Esri'
        }).addTo(geoMapInstance);

        if (internalIps.length === 0 && externalIps.length === 0) {
            summaryContainer.textContent = 'No IP nodes available in topology data.';
            return;
        }

        const [externalResults, localAnchor] = await Promise.all([
            Promise.all(externalIps.map(async (ip) => {
                const geo = await lookupIpGeo(ip);
                return geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon) ? { ip, ...geo } : null;
            })),
            getClientApproxGeo()
        ]);

        const resolvedExternal = [];
        const unresolvedExternal = [];
        externalResults.forEach((result, idx) => {
            if (result) resolvedExternal.push({ ...result, group: 'external', approximate: false });
            else unresolvedExternal.push(externalIps[idx]);
        });

        // Internal IPs are private; they cannot be globally geolocated.
        // Place them at the detected local anchor only (no fake world spread).
        const anchor = localAnchor || { lat: 20, lon: 0, city: 'Approximate Local Region', country: '' };
        const internalPoints = internalIps.map((ip) => ({
            ip,
            group: 'internal',
            approximate: true,
            city: anchor.city || '',
            region: anchor.region || '',
            country: anchor.country || '',
            isp: anchor.isp || '',
            ...createLocalLocalPoint(ip, anchor)
        }));

        const allPoints = [...resolvedExternal, ...internalPoints];
        const ipToGeo = new Map(allPoints.map(p => [p.ip, p]));

        // Ensure top talker is visible even if lookup failed.
        if (topSource && !ipToGeo.has(topSource)) {
            const topIsPublic = isPublicIp(topSource);
            const topGeo = topIsPublic ? await lookupIpGeo(topSource) : null;
            if (topGeo && Number.isFinite(topGeo.lat) && Number.isFinite(topGeo.lon)) {
                ipToGeo.set(topSource, { ip: topSource, group: 'external', approximate: false, ...topGeo });
            } else {
                ipToGeo.set(topSource, {
                    ip: topSource,
                    group: topIsPublic ? 'external' : 'internal',
                    approximate: true,
                    city: anchor.city || '',
                    region: anchor.region || '',
                    country: anchor.country || '',
                    isp: anchor.isp || '',
                    ...createLocalLocalPoint(topSource, anchor)
                });
            }
        }

        const layerGroup = L.layerGroup().addTo(geoMapInstance);

        for (const point of ipToGeo.values()) {
            const isTopSource = point.ip === topSource;
            const isInternal = point.group === 'internal';

            const marker = L.circleMarker([point.lat, point.lon], {
                radius: isTopSource ? 8 : 6,
                color: isTopSource ? '#ef4444' : (isInternal ? '#10b981' : '#3b82f6'),
                fillColor: isTopSource ? '#ef4444' : (isInternal ? '#34d399' : '#60a5fa'),
                fillOpacity: 0.85,
                weight: 2
            });

            const locationParts = [point.city, point.region, point.country].filter(Boolean);
            marker.bindPopup(`
                <div class="ni-geo-popup">
                    <strong>${point.ip}</strong><br>
                    Type: ${isTopSource ? 'Top Talker' : (isInternal ? 'Internal' : 'External')}<br>
                    ${locationParts.join(', ') || 'Location unavailable'}<br>
                    ${point.approximate ? (isInternal ? 'Private IP (local anchor)' : 'Approximate location') : 'Geolocated (provider consensus)'}<br>
                    ISP: ${point.isp || 'Unknown'}
                </div>
            `);

            marker.addTo(layerGroup);
        }

        const maxEdgeValue = Math.max(...edges.map(e => e.value || 0), 1);
        const topSourceGeo = ipToGeo.get(topSource);

        for (const edge of edges) {
            const fromGeo = ipToGeo.get(edge.from);
            const toGeo = ipToGeo.get(edge.to);
            if (!fromGeo || !toGeo) continue;

            const ratio = (edge.value || 0) / maxEdgeValue;
            const weight = 1 + ratio * 4;
            const color = ratio > 0.6 ? '#f59e0b' : '#94a3b8';

            L.polyline(
                [[fromGeo.lat, fromGeo.lon], [toGeo.lat, toGeo.lon]],
                { color, weight, opacity: 0.35 }
            ).addTo(layerGroup);

            // Neon flow overlay for source -> destination visual motion.
            L.polyline(
                [[fromGeo.lat, fromGeo.lon], [toGeo.lat, toGeo.lon]],
                {
                    color: ratio > 0.6 ? '#22d3ee' : '#38bdf8',
                    weight: Math.max(2, weight * 0.6),
                    opacity: 0.95,
                    className: 'ni-neon-flow'
                }
            ).addTo(layerGroup);
        }

        if (topSourceGeo) {
            const sourceConnections = edges.filter(e => e.from === topSource || e.to === topSource);
            for (const edge of sourceConnections) {
                const peer = edge.from === topSource ? edge.to : edge.from;
                const peerGeo = ipToGeo.get(peer);
                if (!peerGeo) continue;

                L.polyline(
                    [[topSourceGeo.lat, topSourceGeo.lon], [peerGeo.lat, peerGeo.lon]],
                    { color: '#ef4444', weight: 2.5, opacity: 0.75 }
                ).addTo(layerGroup);

                L.polyline(
                    [[topSourceGeo.lat, topSourceGeo.lon], [peerGeo.lat, peerGeo.lon]],
                    {
                        color: '#fb7185',
                        weight: 3,
                        opacity: 1,
                        className: 'ni-neon-flow ni-neon-top-flow'
                    }
                ).addTo(layerGroup);
            }
        }

        const allCoords = [...ipToGeo.values()].map(p => [p.lat, p.lon]);
        if (allCoords.length > 0) {
            const bounds = L.latLngBounds(allCoords);
            geoMapInstance.fitBounds(bounds, { padding: [25, 25], maxZoom: 4 });
        }
        setTimeout(() => geoMapInstance.invalidateSize(), 50);

        summaryContainer.textContent =
            `Mapped ${resolvedExternal.length}/${externalIps.length} external IP(s), ` +
            `${internalIps.length} internal IP(s) (private/local anchor), and highlighted top talker ${topSource || 'N/A'}.` +
            (unresolvedExternal.length > 0 ? ` ${unresolvedExternal.length} external IP(s) could not be geolocated exactly.` : '');
    }

    function isPublicIp(ip) {
        if (!ip || typeof ip !== 'string') return false;
        const parts = ip.split('.').map(Number);
        if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return false;

        const [a, b] = parts;
        if (a === 10) return false;
        if (a === 172 && b >= 16 && b <= 31) return false;
        if (a === 192 && b === 168) return false;
        if (a === 127) return false;
        if (a === 169 && b === 254) return false;
        if (a === 100 && b >= 64 && b <= 127) return false;
        if (a === 0) return false;

        return true;
    }

    async function lookupIpGeo(ip) {
        const providers = [
            async () => {
                const res = await fetchWithTimeout(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {}, 5000);
                if (!res.ok) return null;
                const p = await res.json();
                if (p && p.error) return null;
                return {
                    lat: Number(p.latitude),
                    lon: Number(p.longitude),
                    city: p.city || '',
                    region: p.region || '',
                    country: p.country_name || '',
                    isp: p.org || ''
                };
            },
            async () => {
                const res = await fetchWithTimeout(`https://ipwho.is/${encodeURIComponent(ip)}`, {}, 5000);
                if (!res.ok) return null;
                const p = await res.json();
                if (!p || p.success === false) return null;
                return {
                    lat: Number(p.latitude),
                    lon: Number(p.longitude),
                    city: p.city || '',
                    region: p.region || '',
                    country: p.country || '',
                    isp: p.connection && p.connection.isp ? p.connection.isp : ''
                };
            },
            async () => {
                const res = await fetchWithTimeout(`https://ipwhois.app/json/${encodeURIComponent(ip)}`, {}, 5000);
                if (!res.ok) return null;
                const p = await res.json();
                if (!p || p.success === false) return null;
                return {
                    lat: Number(p.latitude),
                    lon: Number(p.longitude),
                    city: p.city || '',
                    region: p.region || '',
                    country: p.country || '',
                    isp: p.isp || ''
                };
            },
            async () => {
                const res = await fetchWithTimeout(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, {}, 5000);
                if (!res.ok) return null;
                const p = await res.json();
                if (!p || !p.loc) return null;
                const [latStr, lonStr] = String(p.loc).split(',');
                return {
                    lat: Number(latStr),
                    lon: Number(lonStr),
                    city: p.city || '',
                    region: p.region || '',
                    country: p.country || '',
                    isp: p.org || ''
                };
            }
        ];

        const candidates = [];
        for (const provider of providers) {
            try {
                const geo = await provider();
                if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon)) candidates.push(geo);
            } catch (error) {
                // Try next provider.
            }
        }

        if (candidates.length === 0) {
            console.warn('IP geolocation lookup failed for:', ip);
            return null;
        }

        // Use centroid of close points; avoids single-provider outliers.
        return buildGeoConsensus(candidates);
    }

    async function getClientApproxGeo() {
        const providers = [
            async () => {
                const res = await fetchWithTimeout('https://ipapi.co/json/', {}, 5000);
                if (!res.ok) return null;
                const p = await res.json();
                if (p && p.error) return null;
                const lat = Number(p.latitude);
                const lon = Number(p.longitude);
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
                return {
                    lat,
                    lon,
                    city: p.city || '',
                    region: p.region || '',
                    country: p.country_name || '',
                    isp: p.org || ''
                };
            },
            async () => {
                const res = await fetchWithTimeout('https://ipwho.is/', {}, 5000);
                if (!res.ok) return null;
                const p = await res.json();
                if (!p || p.success === false) return null;
                const lat = Number(p.latitude);
                const lon = Number(p.longitude);
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
                return {
                    lat,
                    lon,
                    city: p.city || '',
                    region: p.region || '',
                    country: p.country || '',
                    isp: p.connection && p.connection.isp ? p.connection.isp : ''
                };
            }
        ];

        for (const provider of providers) {
            try {
                const geo = await provider();
                if (geo) return geo;
            } catch (error) {
                // Try next provider.
            }
        }

        return null;
    }

    function createLocalLocalPoint(ip, anchor) {
        const hash = ip.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
        const angle = (hash % 360) * (Math.PI / 180);
        const radius = 0.03 + ((hash % 11) / 11) * 0.15; // very small local spread
        const lat = clamp(anchor.lat + Math.sin(angle) * radius, -85, 85);
        const lon = wrapLon(anchor.lon + Math.cos(angle) * radius);
        return { lat, lon };
    }

    function buildGeoConsensus(candidates) {
        if (candidates.length === 1) return candidates[0];

        let bestGroup = [candidates[0]];
        for (const base of candidates) {
            const group = candidates.filter(c => haversineKm(base.lat, base.lon, c.lat, c.lon) <= 600);
            if (group.length > bestGroup.length) bestGroup = group;
        }

        const group = bestGroup.length >= 2 ? bestGroup : candidates;
        const lat = group.reduce((sum, c) => sum + c.lat, 0) / group.length;
        const lon = group.reduce((sum, c) => sum + c.lon, 0) / group.length;

        const bestMeta = group[0];
        return {
            lat,
            lon,
            city: bestMeta.city || '',
            region: bestMeta.region || '',
            country: bestMeta.country || '',
            isp: bestMeta.isp || ''
        };
    }

    function haversineKm(lat1, lon1, lat2, lon2) {
        const toRad = (d) => (d * Math.PI) / 180;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function wrapLon(value) {
        let lon = value;
        while (lon > 180) lon -= 360;
        while (lon < -180) lon += 360;
        return lon;
    }

    async function fetchWithTimeout(resource, options = {}, timeoutMs = 5000) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(resource, { ...options, signal: controller.signal });
        } finally {
            clearTimeout(timeout);
        }
    }

    // --- ARP Deep Analysis ---
    function renderArpAnalysis(data) {
        const alertsContainer = document.getElementById('niArpAlerts');
        const statsContainer = document.getElementById('niArpStats');
        if (!data.arpAnalysis) return;

        const { arpRequests, arpReplies, arpTimeline } = data.arpAnalysis;
        const totalArp = arpRequests + arpReplies;
        const ratio = arpReplies > 0 ? (arpRequests / arpReplies).toFixed(2) : 'N/A';

        // Count unique targets from timeline
        const timelineKeys = Object.keys(arpTimeline || {});
        const maxPerMinute = timelineKeys.length > 0 ? Math.max(...Object.values(arpTimeline)) : 0;

        // --- Threat Detection ---
        const alerts = [];

        if (maxPerMinute > 50) {
            alerts.push({
                level: 'alert-critical',
                icon: 'alert-triangle',
                text: `ARP Storm Detected — Peak of ${maxPerMinute} ARP packets/minute observed`
            });
        }

        if (arpRequests > 100 && ratio !== 'N/A' && parseFloat(ratio) > 5) {
            alerts.push({
                level: 'alert-critical',
                icon: 'search',
                text: `ARP Scanning Suspected — ${arpRequests} requests with request/reply ratio of ${ratio}`
            });
        }

        if (arpReplies > arpRequests && arpReplies > 20) {
            alerts.push({
                level: 'alert-warning',
                icon: 'shield-alert',
                text: `Possible ARP Spoofing — More replies (${arpReplies}) than requests (${arpRequests})`
            });
        }

        if (totalArp > 0 && arpReplies === 0) {
            alerts.push({
                level: 'alert-warning',
                icon: 'alert-circle',
                text: 'ARP Misconfiguration — ARP requests detected but no replies received'
            });
        }

        if (alerts.length === 0) {
            alerts.push({
                level: 'alert-success',
                icon: 'check-circle',
                text: 'No ARP anomalies detected — ARP activity appears normal'
            });
        }

        alertsContainer.innerHTML = alerts.map(a => `
            <div class="ni-alert-banner ${a.level}">
                <i data-lucide="${a.icon}"></i>
                <span>${a.text}</span>
            </div>
        `).join('');

        // ARP Stats
        statsContainer.innerHTML = `
            <div class="ni-arp-stat">
                <span class="ni-arp-stat-value">${arpRequests.toLocaleString()}</span>
                <span class="ni-arp-stat-label">Requests</span>
            </div>
            <div class="ni-arp-stat">
                <span class="ni-arp-stat-value">${arpReplies.toLocaleString()}</span>
                <span class="ni-arp-stat-label">Replies</span>
            </div>
            <div class="ni-arp-stat">
                <span class="ni-arp-stat-value">${ratio}</span>
                <span class="ni-arp-stat-label">Req/Reply Ratio</span>
            </div>
            <div class="ni-arp-stat">
                <span class="ni-arp-stat-value">${timelineKeys.length}</span>
                <span class="ni-arp-stat-label">Active Minutes</span>
            </div>
        `;

        // --- ARP Timeline Chart ---
        if (arpChartInstance) arpChartInstance.destroy();

        const ctx = document.getElementById('niArpChart');
        if (!ctx || timelineKeys.length === 0) return;

        const sortedTimeline = timelineKeys.sort();
        const labels = sortedTimeline.map(t => t.substring(11)); // HH:MM
        const values = sortedTimeline.map(t => arpTimeline[t]);

        arpChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'ARP Packets',
                    data: values,
                    borderColor: '#a855f7',
                    backgroundColor: 'rgba(168, 85, 247, 0.15)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 3,
                    pointBackgroundColor: '#a855f7',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 1,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: '#f8fafc', font: { family: 'Outfit' } }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#94a3b8', stepSize: 1 },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' }
                    },
                    x: {
                        ticks: { color: '#94a3b8', maxRotation: 45 },
                        grid: { display: false }
                    }
                }
            }
        });
    }

    // --- Port & Protocol Distribution ---
    function renderPortDistribution(data) {
        if (!data.protocols && !data.topPorts) return;

        // Protocol doughnut chart
        if (protocolChartInstance) protocolChartInstance.destroy();

        const protoCtx = document.getElementById('niProtocolChart');
        if (protoCtx && data.protocols) {
            const protoLabels = Object.keys(data.protocols);
            const protoValues = Object.values(data.protocols);

            // Add transport protocol breakdown
            if (data.transportProtocols) {
                Object.entries(data.transportProtocols).forEach(([key, val]) => {
                    if (!protoLabels.includes(key)) {
                        protoLabels.push(key);
                        protoValues.push(val);
                    }
                });
            }

            const protoColors = [
                'rgba(99, 102, 241, 0.8)',   // Indigo
                'rgba(168, 85, 247, 0.8)',   // Purple
                'rgba(236, 72, 153, 0.8)',   // Pink
                'rgba(16, 185, 129, 0.8)',   // Green
                'rgba(59, 130, 246, 0.8)',   // Blue
                'rgba(245, 158, 11, 0.8)'    // Amber
            ];

            const protoBorders = protoColors.map(c => c.replace('0.8', '1'));

            protocolChartInstance = new Chart(protoCtx, {
                type: 'doughnut',
                data: {
                    labels: protoLabels,
                    datasets: [{
                        data: protoValues,
                        backgroundColor: protoColors.slice(0, protoLabels.length),
                        borderColor: protoBorders.slice(0, protoLabels.length),
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { color: '#f8fafc', padding: 12, font: { family: 'Outfit' } }
                        }
                    }
                }
            });
        }

        // Top 10 ports table
        const tbody = document.getElementById('niPortTableBody');
        if (tbody && data.topPorts) {
            const totalPortPackets = data.topPorts.reduce((sum, p) => sum + p[1], 0);
            tbody.innerHTML = data.topPorts.map((port, i) => {
                const pct = totalPortPackets > 0 ? ((port[1] / totalPortPackets) * 100).toFixed(1) : '0';
                const portLabel = getPortService(port[0]);
                return `
                    <tr>
                        <td>${i + 1}</td>
                        <td><strong>${port[0]}</strong> <span style="color:var(--text-muted);font-size:0.8rem;">${portLabel}</span></td>
                        <td>${port[1].toLocaleString()}</td>
                        <td><span class="severity-badge severity-${pct > 30 ? 'high' : pct > 10 ? 'medium' : 'low'}">${pct}%</span></td>
                    </tr>
                `;
            }).join('');
        }
    }

    // --- Burst Detection ---
    function renderBurstDetection(data) {
        const alertsContainer = document.getElementById('niBurstAlerts');
        const statsContainer = document.getElementById('niBurstStats');
        if (!data.burstAnalysis) return;

        const {
            packetsPerSecond,
            peakPps,
            avgPps,
            burstCount,
            totalSeconds,
            trafficAsymmetry
        } = data.burstAnalysis;

        // --- Threat Detection ---
        const alerts = [];

        if (peakPps > avgPps * 5 && peakPps > 10) {
            alerts.push({
                level: 'alert-critical',
                icon: 'zap',
                text: `Traffic Spike Detected — Peak of ${peakPps} pps is ${(peakPps / (avgPps || 1)).toFixed(1)}x the average`
            });
        }

        if (peakPps > 100) {
            alerts.push({
                level: 'alert-critical',
                icon: 'shield-alert',
                text: `Possible DDoS Activity — Sustained burst of ${peakPps} packets/second detected`
            });
        }

        if (burstCount >= 3 && avgPps > 2) {
            const burstPct = ((burstCount / (totalSeconds || 1)) * 100).toFixed(1);
            alerts.push({
                level: 'alert-warning',
                icon: 'radio',
                text: `Beaconing Pattern Suspected — ${burstCount} burst intervals detected (${burstPct}% of capture)`
            });
        }

        if (trafficAsymmetry && trafficAsymmetry.ratio > 3) {
            const dominant = trafficAsymmetry.dominant;
            alerts.push({
                level: 'alert-warning',
                icon: 'arrow-right-left',
                text: `Traffic Asymmetry — ${dominant} traffic is ${trafficAsymmetry.ratio.toFixed(1)}x higher (possible exfiltration)`
            });
        }

        if (alerts.length === 0) {
            alerts.push({
                level: 'alert-success',
                icon: 'check-circle',
                text: 'No traffic burst anomalies detected — Traffic patterns appear normal'
            });
        }

        alertsContainer.innerHTML = alerts.map(a => `
            <div class="ni-alert-banner ${a.level}">
                <i data-lucide="${a.icon}"></i>
                <span>${a.text}</span>
            </div>
        `).join('');

        // Stat cards
        const asymRatio = trafficAsymmetry ? trafficAsymmetry.ratio.toFixed(1) : 'N/A';
        statsContainer.innerHTML = `
            <div class="ni-burst-stat">
                <span class="ni-burst-stat-value">${peakPps}</span>
                <span class="ni-burst-stat-label">Peak PPS</span>
            </div>
            <div class="ni-burst-stat">
                <span class="ni-burst-stat-value">${avgPps.toFixed(1)}</span>
                <span class="ni-burst-stat-label">Avg PPS</span>
            </div>
            <div class="ni-burst-stat">
                <span class="ni-burst-stat-value">${burstCount}</span>
                <span class="ni-burst-stat-label">Burst Events</span>
            </div>
            <div class="ni-burst-stat">
                <span class="ni-burst-stat-value">${totalSeconds}s</span>
                <span class="ni-burst-stat-label">Capture Window</span>
            </div>
            <div class="ni-burst-stat">
                <span class="ni-burst-stat-value">${asymRatio}x</span>
                <span class="ni-burst-stat-label">Asymmetry Ratio</span>
            </div>
        `;

        // --- Packets Per Second Chart ---
        if (burstChartInstance) burstChartInstance.destroy();

        const burstCtx = document.getElementById('niBurstChart');
        if (burstCtx && packetsPerSecond) {
            const ppsKeys = Object.keys(packetsPerSecond).sort();
            const ppsLabels = ppsKeys.map(t => t.substring(11)); // HH:MM:SS
            const ppsValues = ppsKeys.map(t => packetsPerSecond[t]);

            // Compute threshold line (avg * 3)
            const threshold = avgPps * 3;
            const thresholdLine = ppsValues.map(() => threshold);

            burstChartInstance = new Chart(burstCtx, {
                type: 'line',
                data: {
                    labels: ppsLabels,
                    datasets: [
                        {
                            label: 'Packets/sec',
                            data: ppsValues,
                            borderColor: '#6366f1',
                            backgroundColor: 'rgba(99, 102, 241, 0.12)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 2,
                            pointBackgroundColor: '#6366f1',
                            borderWidth: 2
                        },
                        {
                            label: 'Burst Threshold',
                            data: thresholdLine,
                            borderColor: 'rgba(239, 68, 68, 0.6)',
                            borderDash: [6, 4],
                            borderWidth: 1.5,
                            pointRadius: 0,
                            fill: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            labels: { color: '#f8fafc', font: { family: 'Outfit' } }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: { color: '#94a3b8' },
                            grid: { color: 'rgba(255, 255, 255, 0.05)' }
                        },
                        x: {
                            ticks: { color: '#94a3b8', maxRotation: 45, maxTicksLimit: 20 },
                            grid: { display: false }
                        }
                    }
                }
            });
        }

        // --- Traffic Asymmetry Chart ---
        if (asymmetryChartInstance) asymmetryChartInstance.destroy();

        const asymCtx = document.getElementById('niAsymmetryChart');
        if (asymCtx && trafficAsymmetry) {
            asymmetryChartInstance = new Chart(asymCtx, {
                type: 'bar',
                data: {
                    labels: ['Source (Outgoing)', 'Destination (Incoming)'],
                    datasets: [{
                        label: 'Unique IPs',
                        data: [trafficAsymmetry.uniqueSources, trafficAsymmetry.uniqueDestinations],
                        backgroundColor: [
                            'rgba(236, 72, 153, 0.7)',
                            'rgba(59, 130, 246, 0.7)'
                        ],
                        borderColor: [
                            'rgba(236, 72, 153, 1)',
                            'rgba(59, 130, 246, 1)'
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
    }

    // --- Port Service Lookup ---
    function getPortService(port) {
        const services = {
            '20': 'FTP Data', '21': 'FTP', '22': 'SSH', '23': 'Telnet',
            '25': 'SMTP', '53': 'DNS', '67': 'DHCP', '68': 'DHCP',
            '80': 'HTTP', '110': 'POP3', '143': 'IMAP', '443': 'HTTPS',
            '445': 'SMB', '993': 'IMAPS', '995': 'POP3S', '3306': 'MySQL',
            '3389': 'RDP', '5432': 'PostgreSQL', '5900': 'VNC', '8080': 'HTTP Alt',
            '8443': 'HTTPS Alt', '137': 'NetBIOS', '138': 'NetBIOS', '139': 'NetBIOS',
            '1433': 'MSSQL', '1434': 'MSSQL', '5060': 'SIP', '5061': 'SIPS'
        };
        return services[String(port)] || '';
    }
});
