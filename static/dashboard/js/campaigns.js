let currentPage = 1;
let campaigns = [];
let filteredCampaigns = [];

function resolveChannel(channel) {
    if (!channel) return 'N/A';
    if (channel === 'rcs' || channel.startsWith('rcs')) return 'RCS';
    return 'WhatsApp';
}

async function loadCampaigns(page = 1) {
    const container = document.getElementById('campaignsContainer');
    const loading = document.getElementById('loadingSpinner');
    const errorContainer = document.getElementById('errorContainer');

    loading.classList.add('active');
    errorContainer.classList.remove('active');
    container.innerHTML = '';

    try {
        const response = await fetch(`${API_BASE}/broadcast?page=${page}&limit=20`, {
            headers: getHeaders()
        });

        if (!response.ok) throw new Error('Erro ao carregar campanhas');

        const data = await response.json();
        campaigns = data.data || [];
        filteredCampaigns = campaigns;

        applyLocalFilters();
        updatePagination(data.meta || { page, total: campaigns.length, totalPages: 1 });
    } catch (error) {
        errorContainer.textContent = 'Erro ao carregar campanhas: ' + error.message;
        errorContainer.classList.add('active');
    } finally {
        loading.classList.remove('active');
    }
}

function applyLocalFilters() {
    const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
    const status = document.getElementById('statusFilter')?.value || '';
    const channel = document.getElementById('channelFilter')?.value || '';

    filteredCampaigns = campaigns.filter(c => {
        const matchesSearch = !search || c.name?.toLowerCase().includes(search) || c.id?.toLowerCase().includes(search);
        const matchesStatus = !status || c.status === status;
        const matchesChannel = !channel || resolveChannel(c.channel).toLowerCase() === channel;
        return matchesSearch && matchesStatus && matchesChannel;
    });

    renderCampaigns();
}

function renderCampaigns() {
    const container = document.getElementById('campaignsContainer');

    if (filteredCampaigns.length === 0) {
        container.innerHTML = '<div class="card"><p>Nenhuma campanha encontrada.</p></div>';
        return;
    }

    container.innerHTML = filteredCampaigns.map(campaign => {
        const ch = resolveChannel(campaign.channel);
        const progress = campaign.totalRecipients > 0
            ? Math.round(((campaign.sentCount || 0) + (campaign.failedCount || 0)) / campaign.totalRecipients * 100)
            : 0;
        const tags = campaign.tags ? (Array.isArray(campaign.tags) ? campaign.tags : [campaign.tags]) : [];

        return `
        <div class="campaign-card" onclick="viewCampaign('${campaign.id}')">
            <div class="campaign-card-header">
                <div>
                    <div class="campaign-title">${campaign.name}</div>
                    <div class="campaign-id">${campaign.id.substring(0, 8)}...</div>
                </div>
                <div style="display:flex;gap:6px;align-items:center">
                    <span class="channel-badge channel-${ch.toLowerCase()}">${ch}</span>
                    <span class="status-badge status-${campaign.status}">${campaign.status}</span>
                </div>
            </div>
            ${campaign.status === 'PROCESSING' ? `
            <div class="progress-bar-mini" style="margin-bottom:12px">
                <div class="progress-fill-mini" style="width:${progress}%"></div>
            </div>` : ''}
            <div class="campaign-stats">
                <div class="stat-item"><span class="stat-label">Total</span><span class="stat-value">${(campaign.totalRecipients || 0).toLocaleString('pt-BR')}</span></div>
                <div class="stat-item"><span class="stat-label">Enviados</span><span class="stat-value">${(campaign.sentCount || 0).toLocaleString('pt-BR')}</span></div>
                <div class="stat-item"><span class="stat-label">Entregues</span><span class="stat-value">${(campaign.deliveredCount || 0).toLocaleString('pt-BR')}</span></div>
                <div class="stat-item"><span class="stat-label">Lidos</span><span class="stat-value">${(campaign.readCount || 0).toLocaleString('pt-BR')}</span></div>
                <div class="stat-item"><span class="stat-label">Falhas</span><span class="stat-value">${(campaign.failedCount || 0).toLocaleString('pt-BR')}</span></div>
                <div class="stat-item"><span class="stat-label">Respostas</span><span class="stat-value">${(campaign.responsesCount || 0).toLocaleString('pt-BR')}</span></div>
            </div>
            ${tags.length ? `<div class="campaign-tags">${tags.map(t => `<span class="tag-badge">${t}</span>`).join('')}</div>` : ''}
            ${campaign.startedAt ? `<div class="campaign-date">Iniciada: ${new Date(campaign.startedAt).toLocaleString('pt-BR')}</div>` : ''}
            ${campaign.createdAt && !campaign.startedAt ? `<div class="campaign-date">Criada: ${new Date(campaign.createdAt).toLocaleString('pt-BR')}</div>` : ''}
        </div>`;
    }).join('');
}

function updatePagination(meta) {
    const pageInfo = document.getElementById('pageInfo');
    currentPage = meta.page || 1;
    pageInfo.textContent = `Pagina ${currentPage} de ${meta.totalPages || 1}`;
    document.getElementById('prevPage').disabled = currentPage <= 1;
    document.getElementById('nextPage').disabled = currentPage >= (meta.totalPages || 1);
}

function previousPage() { if (currentPage > 1) loadCampaigns(currentPage - 1); }
function nextPage() { loadCampaigns(currentPage + 1); }
function refreshCampaigns() { loadCampaigns(currentPage); }
function viewCampaign(id) { window.location.href = `/dashboard/campaign-details.html?id=${id}`; }

document.getElementById('searchInput')?.addEventListener('input', applyLocalFilters);
document.getElementById('statusFilter')?.addEventListener('change', applyLocalFilters);
document.getElementById('channelFilter')?.addEventListener('change', applyLocalFilters);

if (checkAuth()) { loadCampaigns(); }
