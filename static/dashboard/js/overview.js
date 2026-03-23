let overviewTimer = null;

async function loadOverview() {
    try {
        const [overviewRes, queueRes] = await Promise.all([
            fetch(`${API_BASE}/metrics/overview`, { headers: getHeaders() }).catch(() => null),
            fetch(`${API_BASE}/queue/stats`, { headers: getHeaders() }).catch(() => null),
        ]);

        if (overviewRes && overviewRes.ok) {
            const data = await overviewRes.json();
            renderKPIs(data);
            renderStatusDistribution(data.byStatus || {});
        }

        if (queueRes && queueRes.ok) {
            const qData = await queueRes.json();
            renderQueueHealth(qData);
        }

        await loadActiveCampaigns();

        document.getElementById('lastUpdated').textContent =
            'Atualizado: ' + new Date().toLocaleTimeString('pt-BR');
    } catch (e) {
        console.error('Erro ao carregar overview:', e);
    }
}

function renderKPIs(data) {
    const fmt = (n) => (n || 0).toLocaleString('pt-BR');
    const pct = (n) => (n != null ? n + '%' : '--');

    document.getElementById('kpiTotal').textContent = fmt(data.totalCampaigns);
    document.getElementById('kpiSent').textContent = fmt(data.totalSent);
    document.getElementById('kpiDelivered').textContent = fmt(data.totalDelivered);
    document.getElementById('kpiDeliveredRate').textContent = pct(data.rates?.delivery);
    document.getElementById('kpiRead').textContent = fmt(data.totalRead);
    document.getElementById('kpiReadRate').textContent = pct(data.rates?.read);
    document.getElementById('kpiFailed').textContent = fmt(data.totalFailed);
    document.getElementById('kpiFailedRate').textContent = pct(data.rates?.failure);
    document.getElementById('kpiResponses').textContent = fmt(data.totalResponses || 0);
    document.getElementById('kpiResponseRate').textContent = pct(data.rates?.response);
}

function renderStatusDistribution(byStatus) {
    const container = document.getElementById('statusDistribution');
    const statusLabels = {
        DRAFT: 'Rascunho',
        SCHEDULED: 'Agendada',
        PROCESSING: 'Em andamento',
        COMPLETED: 'Concluida',
        PAUSED: 'Pausada',
        CANCELED: 'Cancelada',
        FAILED: 'Falha',
    };

    const entries = Object.entries(statusLabels)
        .map(([key, label]) => ({ key, label, count: byStatus[key] || 0 }))
        .filter((e) => e.count > 0);

    if (!entries.length) {
        container.innerHTML = '<p class="text-muted">Nenhuma campanha registrada</p>';
        return;
    }

    container.innerHTML = entries
        .map(
            (e) => `
        <div class="status-dist-item">
            <span class="status-badge status-${e.key}">${e.label}</span>
            <strong>${e.count}</strong>
        </div>
    `,
        )
        .join('');
}

async function loadActiveCampaigns() {
    const container = document.getElementById('activeCampaigns');

    try {
        const res = await fetch(`${API_BASE}/metrics/active`, { headers: getHeaders() });
        if (!res.ok) {
            container.innerHTML = '<p class="text-muted">Nao foi possivel carregar</p>';
            return;
        }
        const data = await res.json();
        const campaigns = Array.isArray(data) ? data : data.campaigns || [];

        if (!campaigns.length) {
            container.innerHTML = '<p class="text-muted">Nenhuma campanha ativa no momento</p>';
            return;
        }

        container.innerHTML = campaigns
            .slice(0, 5)
            .map((c) => {
                const progress =
                    c.stats?.totalRecipients > 0
                        ? Math.round(((c.stats?.sent || 0) / c.stats.totalRecipients) * 100)
                        : 0;
                const channel = resolveChannelLabel(c.channel);

                return `
                <div class="active-campaign-item" onclick="window.location.href='campaign-details.html?id=${c.campaignId || c.id}'">
                    <div class="active-campaign-info">
                        <strong>${c.name || c.campaignId || c.id}</strong>
                        <span class="channel-badge channel-${channel.toLowerCase()}">${channel}</span>
                    </div>
                    <div class="progress-bar-mini">
                        <div class="progress-fill-mini" style="width: ${progress}%"></div>
                    </div>
                    <span class="text-muted" style="font-size:0.8rem">${progress}% — ${(c.stats?.sent || 0).toLocaleString('pt-BR')} / ${(c.stats?.totalRecipients || 0).toLocaleString('pt-BR')}</span>
                </div>
            `;
            })
            .join('');
    } catch (e) {
        container.innerHTML = '<p class="text-muted">Erro ao carregar campanhas ativas</p>';
    }
}

function renderQueueHealth(data) {
    const container = document.getElementById('queueHealth');

    const queues = [];
    if (data.broadcast) queues.push({ name: 'Broadcast', ...data.broadcast });
    if (data.webhook) queues.push({ name: 'Webhook', ...data.webhook });
    if (data.dlq) queues.push({ name: 'DLQ', ...data.dlq });
    // fallback: flat format
    if (!queues.length && data.waiting != null) {
        queues.push({ name: 'Principal', ...data });
    }

    if (!queues.length) {
        container.innerHTML = '<p class="text-muted">Sem dados de filas</p>';
        return;
    }

    container.innerHTML = queues
        .map(
            (q) => `
        <div class="queue-card">
            <h4>${q.name}</h4>
            <div class="queue-stats">
                <div class="queue-stat">
                    <span class="queue-stat-value">${(q.waiting || 0).toLocaleString('pt-BR')}</span>
                    <span class="queue-stat-label">Esperando</span>
                </div>
                <div class="queue-stat">
                    <span class="queue-stat-value">${(q.active || 0).toLocaleString('pt-BR')}</span>
                    <span class="queue-stat-label">Ativas</span>
                </div>
                <div class="queue-stat">
                    <span class="queue-stat-value">${(q.completed || 0).toLocaleString('pt-BR')}</span>
                    <span class="queue-stat-label">Concluidas</span>
                </div>
                <div class="queue-stat">
                    <span class="queue-stat-value">${(q.failed || 0).toLocaleString('pt-BR')}</span>
                    <span class="queue-stat-label">Falhas</span>
                </div>
            </div>
        </div>
    `,
        )
        .join('');
}

function resolveChannelLabel(channel) {
    if (!channel) return 'N/A';
    if (channel === 'rcs' || channel.startsWith('rcs')) return 'RCS';
    return 'WhatsApp';
}

// Auto-refresh a cada 30s
function startAutoRefresh() {
    if (overviewTimer) clearInterval(overviewTimer);
    overviewTimer = setInterval(loadOverview, 30000);
}

if (checkAuth()) {
    loadOverview();
    startAutoRefresh();
}
