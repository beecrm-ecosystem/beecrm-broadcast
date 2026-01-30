const urlParams = new URLSearchParams(window.location.search);
const campaignId = urlParams.get('id');

if (!campaignId) {
    window.location.href = '/dashboard/campaigns.html';
}

let campaign = null;
let stats = null;
let recipients = [];
let allRecipients = [];
let filteredRecipients = [];
let currentTab = 'overview';
let recipientsPage = 1;
let recipientStatusFilter = '';
let recipientSearchTerm = '';

// Carrega dados da campanha
async function loadCampaignData() {
    try {
        const [campaignRes, statsRes] = await Promise.all([
            fetch(`${API_BASE}/broadcast/${campaignId}`, { headers: getHeaders() }),
            fetch(`${API_BASE}/broadcast/${campaignId}/stats`, { headers: getHeaders() })
        ]);
        
        if (!campaignRes.ok || !statsRes.ok) {
            throw new Error('Erro ao carregar dados da campanha');
        }
        
        campaign = await campaignRes.json();
        stats = await statsRes.json();
        
        renderCampaignHeader();
        renderStats();
        renderOverview();
        updateActionButtons();
    } catch (error) {
        alert('Erro ao carregar campanha: ' + error.message);
        window.location.href = '/dashboard/campaigns.html';
    }
}

// Renderiza header
function renderCampaignHeader() {
    document.getElementById('campaignHeader').innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 20px;">
            <div>
                <h2>${campaign.name}</h2>
                <p style="color: #7f8c8d; font-size: 0.9rem;">${campaign.id}</p>
            </div>
            <span class="status-badge status-${campaign.status}">${campaign.status}</span>
        </div>
        ${campaign.startedAt ? `<p style="color: #7f8c8d;">Iniciada: ${new Date(campaign.startedAt).toLocaleString('pt-BR')}</p>` : ''}
        ${campaign.completedAt ? `<p style="color: #7f8c8d;">Concluída: ${new Date(campaign.completedAt).toLocaleString('pt-BR')}</p>` : ''}
    `;
}

// Renderiza estatísticas
function renderStats() {
    const statsGrid = document.getElementById('statsGrid');
    const s = stats.stats;
    
    statsGrid.innerHTML = `
        <div class="stat-card">
            <h4>Total</h4>
            <div class="value">${s.totalRecipients}</div>
        </div>
        <div class="stat-card">
            <h4>Enviados</h4>
            <div class="value">${s.sent}</div>
            <div class="label">${stats.rates.success}</div>
        </div>
        <div class="stat-card">
            <h4>Entregues</h4>
            <div class="value">${s.delivered}</div>
            <div class="label">${stats.rates.delivery}</div>
        </div>
        <div class="stat-card">
            <h4>Lidos</h4>
            <div class="value">${s.read}</div>
            <div class="label">${stats.rates.read}</div>
        </div>
        <div class="stat-card">
            <h4>Falhas</h4>
            <div class="value">${s.failed}</div>
            <div class="label">${stats.rates.failure}</div>
        </div>
        <div class="stat-card">
            <h4>Pendentes</h4>
            <div class="value">${Math.max(0, s.pending)}</div>
        </div>
    `;
}

// Renderiza visão geral
function renderOverview() {
    const ratesChart = document.getElementById('ratesChart');
    const statusDist = document.getElementById('statusDistribution');
    const s = stats.stats;
    
    // Renderiza gráfico de taxas
    ratesChart.innerHTML = `
        <div style="display: grid; gap: 15px; padding: 20px;">
            <div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>Taxa de Sucesso (Enviados)</span>
                    <strong>${stats.rates.success}</strong>
                </div>
                <div style="background: #ecf0f1; border-radius: 10px; height: 20px; overflow: hidden;">
                    <div style="background: #27ae60; height: 100%; width: ${stats.rates.success}; transition: width 0.3s;"></div>
                </div>
            </div>
            <div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>Taxa de Entrega</span>
                    <strong>${stats.rates.delivery}</strong>
                </div>
                <div style="background: #ecf0f1; border-radius: 10px; height: 20px; overflow: hidden;">
                    <div style="background: #3498db; height: 100%; width: ${stats.rates.delivery}; transition: width 0.3s;"></div>
                </div>
            </div>
            <div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>Taxa de Leitura</span>
                    <strong>${stats.rates.read}</strong>
                </div>
                <div style="background: #ecf0f1; border-radius: 10px; height: 20px; overflow: hidden;">
                    <div style="background: #9b59b6; height: 100%; width: ${stats.rates.read}; transition: width 0.3s;"></div>
                </div>
            </div>
            <div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>Taxa de Falha</span>
                    <strong>${stats.rates.failure}</strong>
                </div>
                <div style="background: #ecf0f1; border-radius: 10px; height: 20px; overflow: hidden;">
                    <div style="background: #e74c3c; height: 100%; width: ${stats.rates.failure}; transition: width 0.3s;"></div>
                </div>
            </div>
        </div>
    `;
    
    statusDist.innerHTML = `
        <div style="display: grid; gap: 10px;">
            <div class="stat-item">
                <span>✅ Sucesso (Enviado)</span>
                <strong>${s.sent} (${stats.rates.success})</strong>
            </div>
            <div class="stat-item">
                <span>📬 Entregue</span>
                <strong>${s.delivered} (${stats.rates.delivery})</strong>
            </div>
            <div class="stat-item">
                <span>👁️ Lido</span>
                <strong>${s.read} (${stats.rates.read})</strong>
            </div>
            <div class="stat-item">
                <span>❌ Falhas</span>
                <strong>${s.failed} (${stats.rates.failure})</strong>
            </div>
            <div class="stat-item">
                <span>⏳ Pendente</span>
                <strong>${Math.max(0, s.pending)}</strong>
            </div>
        </div>
    `;
}

// Tabs
function showTab(tabName) {
    currentTab = tabName;
    
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    document.querySelector(`[onclick="showTab('${tabName}')"]`)?.classList.add('active');
    document.getElementById(tabName)?.classList.add('active');
    
    if (tabName === 'recipients') {
        if (allRecipients.length === 0) {
            loadRecipients();
        }
        setupRecipientsFilters();
    } else if (tabName === 'errors') {
        loadErrorsAnalysis();
    } else if (tabName === 'engagement') {
        renderEngagement();
    }
}

// Carrega destinatários
async function loadRecipients(page = 1) {
    try {
        // Carrega todos os destinatários para permitir filtros locais
        if (allRecipients.length === 0) {
            const response = await fetch(`${API_BASE}/broadcast/${campaignId}/recipients?page=1&limit=1000`, {
                headers: getHeaders()
            });
            
            if (!response.ok) throw new Error('Erro ao carregar destinatários');
            
            const data = await response.json();
            allRecipients = data.data || [];
        }
        
        applyRecipientsFilters();
        renderRecipientsPaginated(page);
    } catch (error) {
        alert('Erro ao carregar destinatários: ' + error.message);
    }
}

// Aplica filtros aos destinatários
function applyRecipientsFilters() {
    filteredRecipients = allRecipients.filter(r => {
        const matchesStatus = !recipientStatusFilter || r.status === recipientStatusFilter;
        const matchesSearch = !recipientSearchTerm || 
            r.name?.toLowerCase().includes(recipientSearchTerm.toLowerCase()) ||
            r.phoneNumber?.includes(recipientSearchTerm);
        
        return matchesStatus && matchesSearch;
    });
}

// Renderiza destinatários paginados
function renderRecipientsPaginated(page = 1) {
    const pageSize = 50;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const paginatedRecipients = filteredRecipients.slice(start, end);
    
    recipients = paginatedRecipients;
    renderRecipients();
    
    const totalPages = Math.ceil(filteredRecipients.length / pageSize);
    updateRecipientsPagination({
        page,
        total: filteredRecipients.length,
        totalPages,
        limit: pageSize
    });
}

// Renderiza destinatários
function renderRecipients() {
    const table = document.getElementById('recipientsTable');
    
    if (recipients.length === 0) {
        table.innerHTML = '<p>Nenhum destinatário encontrado.</p>';
        return;
    }
    
    table.innerHTML = `
        <div style="margin-bottom: 15px; color: #7f8c8d;">
            Mostrando ${recipients.length} de ${filteredRecipients.length} destinatários
            ${filteredRecipients.length !== allRecipients.length ? `(${allRecipients.length} total)` : ''}
        </div>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Nome</th>
                        <th>Telefone</th>
                        <th>Status</th>
                        <th>Enviado</th>
                        <th>Entregue</th>
                        <th>Lido</th>
                        <th>Erro</th>
                    </tr>
                </thead>
                <tbody>
                    ${recipients.map(r => {
                        const msg = r.messages?.[0];
                        return `
                            <tr>
                                <td>${r.name || 'N/A'}</td>
                                <td>${r.phoneNumber}</td>
                                <td><span class="status-badge status-${r.status}">${r.status}</span></td>
                                <td>${msg?.sentAt ? new Date(msg.sentAt).toLocaleString('pt-BR') : '-'}</td>
                                <td>${msg?.deliveredAt ? new Date(msg.deliveredAt).toLocaleString('pt-BR') : '-'}</td>
                                <td>${msg?.readAt ? new Date(msg.readAt).toLocaleString('pt-BR') : '-'}</td>
                                <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis;" title="${msg?.errorMessage || ''}">${msg?.errorMessage || '-'}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// Paginação destinatários
function updateRecipientsPagination(meta) {
    const pageInfo = document.getElementById('pageInfoRecipients');
    const prevBtn = document.getElementById('prevPageRecipients');
    const nextBtn = document.getElementById('nextPageRecipients');
    
    recipientsPage = meta.page;
    pageInfo.textContent = `Página ${meta.page} de ${meta.totalPages}`;
    
    prevBtn.disabled = meta.page <= 1;
    nextBtn.disabled = meta.page >= meta.totalPages;
}

function previousPageRecipients() {
    if (recipientsPage > 1) {
        renderRecipientsPaginated(recipientsPage - 1);
    }
}

function nextPageRecipients() {
    renderRecipientsPaginated(recipientsPage + 1);
}

// Event listeners para filtros
function setupRecipientsFilters() {
    document.getElementById('recipientSearch')?.addEventListener('input', (e) => {
        recipientSearchTerm = e.target.value;
        applyRecipientsFilters();
        renderRecipientsPaginated(1);
    });
    
    document.getElementById('recipientStatusFilter')?.addEventListener('change', (e) => {
        recipientStatusFilter = e.target.value;
        applyRecipientsFilters();
        renderRecipientsPaginated(1);
    });
}

// Exporta destinatários filtrados para CSV
function exportRecipients() {
    if (filteredRecipients.length === 0) {
        alert('Nenhum destinatário para exportar');
        return;
    }
    
    const headers = ['Nome', 'Telefone', 'Status', 'Ativo', 'Enviado Em', 'Entregue Em', 'Lido Em', 'Falha Em', 'Código Erro', 'Mensagem Erro'];
    
    const rows = filteredRecipients.map(r => {
        const msg = r.messages?.[0];
        return [
            r.name || '',
            r.phoneNumber || '',
            r.status || '',
            r.isActive ? 'Sim' : 'Não',
            msg?.sentAt ? new Date(msg.sentAt).toLocaleString('pt-BR') : '',
            msg?.deliveredAt ? new Date(msg.deliveredAt).toLocaleString('pt-BR') : '',
            msg?.readAt ? new Date(msg.readAt).toLocaleString('pt-BR') : '',
            msg?.failedAt ? new Date(msg.failedAt).toLocaleString('pt-BR') : '',
            msg?.errorCode || '',
            (msg?.errorMessage || '').replace(/"/g, '""')
        ];
    });
    
    const csvContent = [
        headers.map(h => `"${h}"`).join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `campanha-${campaignId}-destinatarios-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    alert(`${filteredRecipients.length} destinatários exportados com sucesso!`);
}

// Análise de erros
async function loadErrorsAnalysis() {
    const container = document.getElementById('errorsAnalysis');
    container.innerHTML = '<p>Carregando análise de erros...</p>';
    
    try {
        // Carrega todos os recipients para análise
        const response = await fetch(`${API_BASE}/broadcast/${campaignId}/recipients?page=1&limit=1000`, {
            headers: getHeaders()
        });
        
        if (!response.ok) throw new Error('Erro ao carregar dados');
        
        const data = await response.json();
        const allRecipients = data.data || [];
        
        const analysis = analyzeErrors(allRecipients);
        
        container.innerHTML = `
            <div style="display: grid; gap: 20px;">
                <div>
                    <h4>Resumo</h4>
                    <div class="stat-item">
                        <span>Total analisado</span>
                        <strong>${analysis.total}</strong>
                    </div>
                    <div class="stat-item">
                        <span>Falhas com detalhes</span>
                        <strong>${analysis.failedWithDetails}</strong>
                    </div>
                    <div class="stat-item">
                        <span>Falhas sem detalhes</span>
                        <strong>${analysis.failedWithoutDetails}</strong>
                    </div>
                </div>
                ${Object.keys(analysis.errorCodes).length > 0 ? `
                    <div>
                        <h4>Códigos de Erro</h4>
                        ${Object.entries(analysis.errorCodes).map(([code, count]) => `
                            <div class="stat-item">
                                <span>${code}</span>
                                <strong>${count}</strong>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    } catch (error) {
        container.innerHTML = `<p style="color: var(--danger);">Erro: ${error.message}</p>`;
    }
}

function analyzeErrors(recipients) {
    const analysis = {
        total: recipients.length,
        failedWithDetails: 0,
        failedWithoutDetails: 0,
        errorCodes: {}
    };
    
    for (const r of recipients) {
        if (r.status === 'FAILED' || !r.isActive) {
            const msg = r.messages?.find(m => m.status === 'FAILED');
            if (msg?.errorCode) {
                analysis.failedWithDetails++;
                analysis.errorCodes[msg.errorCode] = (analysis.errorCodes[msg.errorCode] || 0) + 1;
            } else {
                analysis.failedWithoutDetails++;
            }
        }
    }
    
    return analysis;
}

// Engajamento
function renderEngagement() {
    const hourly = document.getElementById('hourlyEngagement');
    const best = document.getElementById('bestHours');
    
    if (!stats.engagement) {
        hourly.innerHTML = '<p>Sem dados de engajamento</p>';
        best.innerHTML = '<p>Sem dados de engajamento</p>';
        return;
    }
    
    hourly.innerHTML = stats.engagement.hourlyDistribution
        .filter(h => h.engagementScore > 0)
        .map(h => `
            <div class="stat-item">
                <span>${h.hour}:00</span>
                <span>Leituras: ${h.reads} | Respostas: ${h.responses}</span>
            </div>
        `).join('') || '<p>Sem engajamento registrado</p>';
    
    best.innerHTML = stats.engagement.bestHours
        .map((h, i) => `
            <div class="stat-item">
                <span>🏆 ${i + 1}º - ${h.hour}:00</span>
                <strong>Score: ${h.engagementScore}</strong>
            </div>
        `).join('') || '<p>Sem dados</p>';
}

// Ações
function updateActionButtons() {
    document.getElementById('pauseBtn').style.display = campaign.status === 'PROCESSING' ? 'block' : 'none';
    document.getElementById('resumeBtn').style.display = campaign.status === 'PAUSED' ? 'block' : 'none';
    document.getElementById('requeueBtn').style.display = ['PROCESSING', 'PAUSED'].includes(campaign.status) ? 'block' : 'none';
    document.getElementById('cancelBtn').style.display = !['COMPLETED', 'CANCELED'].includes(campaign.status) ? 'block' : 'none';
}

async function requeueCampaign() {
    if (!confirm('Deseja reenfileirar esta campanha?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/broadcast/${campaignId}/requeue`, {
            method: 'POST',
            headers: getHeaders()
        });
        
        if (!response.ok) throw new Error('Erro ao reenfileirar');
        
        alert('Campanha reenfileirada com sucesso!');
        location.reload();
    } catch (error) {
        alert('Erro: ' + error.message);
    }
}

async function pauseCampaign() {
    if (!confirm('Deseja pausar esta campanha?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/broadcast/${campaignId}/pause`, {
            method: 'POST',
            headers: getHeaders()
        });
        
        if (!response.ok) throw new Error('Erro ao pausar');
        
        alert('Campanha pausada com sucesso!');
        location.reload();
    } catch (error) {
        alert('Erro: ' + error.message);
    }
}

async function resumeCampaign() {
    if (!confirm('Deseja retomar esta campanha?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/broadcast/${campaignId}/resume`, {
            method: 'POST',
            headers: getHeaders()
        });
        
        if (!response.ok) throw new Error('Erro ao retomar');
        
        alert('Campanha retomada com sucesso!');
        location.reload();
    } catch (error) {
        alert('Erro: ' + error.message);
    }
}

async function cancelCampaign() {
    if (!confirm('Deseja cancelar esta campanha? Esta ação não pode ser desfeita.')) return;
    
    try {
        const response = await fetch(`${API_BASE}/broadcast/${campaignId}/cancel`, {
            method: 'POST',
            headers: getHeaders()
        });
        
        if (!response.ok) throw new Error('Erro ao cancelar');
        
        alert('Campanha cancelada com sucesso!');
        location.reload();
    } catch (error) {
        alert('Erro: ' + error.message);
    }
}

// Carrega ao iniciar
if (checkAuth()) {
    loadCampaignData();
    setupRecipientsFilters();
}
