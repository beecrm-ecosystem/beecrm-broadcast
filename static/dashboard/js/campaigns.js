let currentPage = 1;
let campaigns = [];
let filteredCampaigns = [];

// Carrega campanhas
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
        
        renderCampaigns();
        updatePagination(data.meta || { page, total: campaigns.length, totalPages: 1 });
    } catch (error) {
        errorContainer.textContent = 'Erro ao carregar campanhas: ' + error.message;
        errorContainer.classList.add('active');
    } finally {
        loading.classList.remove('active');
    }
}

// Renderiza campanhas
function renderCampaigns() {
    const container = document.getElementById('campaignsContainer');
    
    if (filteredCampaigns.length === 0) {
        container.innerHTML = '<div class="card"><p>Nenhuma campanha encontrada.</p></div>';
        return;
    }
    
    container.innerHTML = filteredCampaigns.map(campaign => `
        <div class="campaign-card" onclick="viewCampaign('${campaign.id}')">
            <div class="campaign-card-header">
                <div>
                    <div class="campaign-title">${campaign.name}</div>
                    <div class="campaign-id">${campaign.id}</div>
                </div>
                <span class="status-badge status-${campaign.status}">${campaign.status}</span>
            </div>
            <div class="campaign-stats">
                <div class="stat-item">
                    <span class="stat-label">Total</span>
                    <span class="stat-value">${campaign.totalRecipients || 0}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Enviados</span>
                    <span class="stat-value">${campaign.sentCount || 0}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Entregues</span>
                    <span class="stat-value">${campaign.deliveredCount || 0}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Falhas</span>
                    <span class="stat-value">${campaign.failedCount || 0}</span>
                </div>
            </div>
            ${campaign.startedAt ? `<div style="margin-top: 10px; font-size: 0.85rem; color: #7f8c8d;">
                Iniciada: ${new Date(campaign.startedAt).toLocaleString('pt-BR')}
            </div>` : ''}
        </div>
    `).join('');
}

// Atualiza paginação
function updatePagination(meta) {
    const pageInfo = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    
    currentPage = meta.page || 1;
    pageInfo.textContent = `Página ${currentPage} de ${meta.totalPages || 1}`;
    
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= (meta.totalPages || 1);
}

// Navegação
function previousPage() {
    if (currentPage > 1) {
        loadCampaigns(currentPage - 1);
    }
}

function nextPage() {
    loadCampaigns(currentPage + 1);
}

function refreshCampaigns() {
    loadCampaigns(currentPage);
}

// View detalhes
function viewCampaign(id) {
    window.location.href = `/dashboard/campaign-details.html?id=${id}`;
}

// Filtros
document.getElementById('searchInput')?.addEventListener('input', (e) => {
    const search = e.target.value.toLowerCase();
    filteredCampaigns = campaigns.filter(c => 
        c.name?.toLowerCase().includes(search) || 
        c.id?.toLowerCase().includes(search)
    );
    renderCampaigns();
});

document.getElementById('statusFilter')?.addEventListener('change', (e) => {
    const status = e.target.value;
    filteredCampaigns = status ? campaigns.filter(c => c.status === status) : campaigns;
    renderCampaigns();
});

// Carrega ao iniciar
if (checkAuth()) {
    loadCampaigns();
}
