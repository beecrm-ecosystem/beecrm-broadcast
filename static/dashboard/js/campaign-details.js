const urlParams = new URLSearchParams(window.location.search);
const campaignId = urlParams.get('id');

if (!campaignId) {
    window.location.href = '/dashboard/campaigns.html';
}

let campaign = null;
let stats = null;
let recipients = [];
let currentTab = 'overview';
let recipientsPage = 1;

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
    const statusDist = document.getElementById('statusDistribution');
    const s = stats.stats;
    
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
    
    if (tabName === 'recipients' && recipients.length === 0) {
        loadRecipients();
    } else if (tabName === 'errors') {
        loadErrorsAnalysis();
    } else if (tabName === 'engagement') {
        renderEngagement();
    }
}

// Carrega destinatários
async function loadRecipients(page = 1) {
    try {
        const response = await fetch(`${API_BASE}/broadcast/${campaignId}/recipients?page=${page}&limit=50`, {
            headers: getHeaders()
        });
        
        if (!response.ok) throw new Error('Erro ao carregar destinatários');
        
        const data = await response.json();
        recipients = data.data || [];
        
        renderRecipients();
        updateRecipientsPagination(data.meta);
    } catch (error) {
        alert('Erro ao carregar destinatários: ' + error.message);
    }
}

// Renderiza destinatários
function renderRecipients() {
    const table = document.getElementById('recipientsTable');
    
    if (recipients.length === 0) {
        table.innerHTML = '<p>Nenhum destinatário encontrado.</p>';
        return;
    }
    
    table.innerHTML = `
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
                                <td>${msg?.errorMessage || '-'}</td>
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
        loadRecipients(recipientsPage - 1);
    }
}

function nextPageRecipients() {
    loadRecipients(recipientsPage + 1);
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
}
