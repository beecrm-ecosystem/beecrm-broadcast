const urlParams = new URLSearchParams(window.location.search);
const campaignId = urlParams.get('id');
if (!campaignId) window.location.href = '/dashboard/campaigns.html';

let campaign = null;
let stats = null;
let allRecipients = [];
let filteredRecipients = [];
let currentTab = 'overview';
let recipientsPage = 1;
let recipientStatusFilter = '';
let recipientSearchTerm = '';
let autoRefreshTimer = null;

function resolveChannel(channel) {
    if (!channel) return 'N/A';
    if (channel === 'rcs' || channel.startsWith('rcs')) return 'RCS';
    return 'WhatsApp';
}

// ---- Data loading ----

async function loadCampaignData() {
    try {
        const [campaignRes, statsRes] = await Promise.all([
            fetch(`${API_BASE}/broadcast/${campaignId}`, { headers: getHeaders() }),
            fetch(`${API_BASE}/broadcast/${campaignId}/stats`, { headers: getHeaders() })
        ]);

        if (!campaignRes.ok || !statsRes.ok) throw new Error('Erro ao carregar dados');

        campaign = await campaignRes.json();
        stats = await statsRes.json();

        renderCampaignHeader();
        renderStats();
        renderOverview();
        updateActionButtons();
        manageAutoRefresh();
    } catch (error) {
        alert('Erro ao carregar campanha: ' + error.message);
        window.location.href = '/dashboard/campaigns.html';
    }
}

// ---- Header ----

function renderCampaignHeader() {
    const ch = resolveChannel(campaign.channel);
    document.getElementById('campaignHeader').innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:20px">
            <div>
                <h2>${campaign.name}</h2>
                <p class="text-muted">${campaign.id}</p>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
                <span class="channel-badge channel-${ch.toLowerCase()}">${ch}</span>
                <span class="status-badge status-${campaign.status}">${campaign.status}</span>
            </div>
        </div>
        <div class="campaign-meta">
            ${campaign.startedAt ? `<span>Iniciada: ${new Date(campaign.startedAt).toLocaleString('pt-BR')}</span>` : ''}
            ${campaign.completedAt ? `<span>Concluida: ${new Date(campaign.completedAt).toLocaleString('pt-BR')}</span>` : ''}
            ${campaign.createdAt ? `<span>Criada: ${new Date(campaign.createdAt).toLocaleString('pt-BR')}</span>` : ''}
        </div>
    `;
}

// ---- Stats grid ----

function renderStats() {
    const s = stats.stats;
    const r = stats.rates || {};
    const responded = s.responded || campaign.respondedCount || 0;
    const optOut = campaign.optOutCount || 0;
    const responseRate = r.response || (s.totalRecipients > 0 ? ((responded / s.totalRecipients) * 100).toFixed(1) + '%' : '0%');
    const optOutRate = s.totalRecipients > 0 ? ((optOut / s.totalRecipients) * 100).toFixed(1) + '%' : '0%';

    // Avg response time
    let avgResponseTime = '--';
    if (stats.responseTimes?.average != null) {
        const secs = stats.responseTimes.average;
        if (secs < 60) avgResponseTime = Math.round(secs) + 's';
        else if (secs < 3600) avgResponseTime = Math.round(secs / 60) + 'min';
        else avgResponseTime = (secs / 3600).toFixed(1) + 'h';
    }

    document.getElementById('statsGrid').innerHTML = `
        <div class="stat-card"><h4>Total</h4><div class="value">${s.totalRecipients.toLocaleString('pt-BR')}</div></div>
        <div class="stat-card"><h4>Enviados</h4><div class="value">${s.sent.toLocaleString('pt-BR')}</div><div class="label">${r.success || '0%'}</div></div>
        <div class="stat-card"><h4>Entregues</h4><div class="value">${s.delivered.toLocaleString('pt-BR')}</div><div class="label">${r.delivery || '0%'}</div></div>
        <div class="stat-card"><h4>Lidos</h4><div class="value">${s.read.toLocaleString('pt-BR')}</div><div class="label">${r.read || '0%'}</div></div>
        <div class="stat-card"><h4>Falhas</h4><div class="value">${s.failed.toLocaleString('pt-BR')}</div><div class="label">${r.failure || '0%'}</div></div>
        <div class="stat-card"><h4>Pendentes</h4><div class="value">${Math.max(0, s.pending).toLocaleString('pt-BR')}</div></div>
        <div class="stat-card"><h4>Respostas</h4><div class="value">${responded.toLocaleString('pt-BR')}</div><div class="label">${responseRate}</div></div>
        <div class="stat-card"><h4>Opt-out</h4><div class="value">${optOut.toLocaleString('pt-BR')}</div><div class="label">${optOutRate}</div></div>
        <div class="stat-card"><h4>Tempo medio resp.</h4><div class="value">${avgResponseTime}</div></div>
    `;
}

// ---- Overview tab ----

function renderOverview() {
    const r = stats.rates || {};
    const ratesChart = document.getElementById('ratesChart');
    const statusDist = document.getElementById('statusDistribution');
    const s = stats.stats;

    const bars = [
        { label: 'Sucesso (Enviados)', rate: r.success, color: '#27ae60' },
        { label: 'Entrega', rate: r.delivery, color: '#3498db' },
        { label: 'Leitura', rate: r.read, color: '#9b59b6' },
        { label: 'Resposta', rate: r.response || '0%', color: '#f39c12' },
        { label: 'Falha', rate: r.failure, color: '#e74c3c' },
    ];

    ratesChart.innerHTML = `<div style="display:grid;gap:15px;padding:20px">
        ${bars.map(b => `
            <div>
                <div style="display:flex;justify-content:space-between;margin-bottom:5px">
                    <span>${b.label}</span><strong>${b.rate || '0%'}</strong>
                </div>
                <div style="background:#ecf0f1;border-radius:10px;height:20px;overflow:hidden">
                    <div style="background:${b.color};height:100%;width:${b.rate || '0%'};transition:width 0.3s"></div>
                </div>
            </div>
        `).join('')}
    </div>`;

    statusDist.innerHTML = `<div style="display:grid;gap:10px">
        <div class="stat-item"><span>Enviados</span><strong>${s.sent} (${r.success})</strong></div>
        <div class="stat-item"><span>Entregues</span><strong>${s.delivered} (${r.delivery})</strong></div>
        <div class="stat-item"><span>Lidos</span><strong>${s.read} (${r.read})</strong></div>
        <div class="stat-item"><span>Falhas</span><strong>${s.failed} (${r.failure})</strong></div>
        <div class="stat-item"><span>Pendentes</span><strong>${Math.max(0, s.pending)}</strong></div>
    </div>`;
}

// ---- Tabs ----

function showTab(tabName) {
    currentTab = tabName;
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`[onclick="showTab('${tabName}')"]`)?.classList.add('active');
    document.getElementById(tabName)?.classList.add('active');

    if (tabName === 'recipients' && allRecipients.length === 0) loadRecipients();
    if (tabName === 'errors') loadErrorsAnalysis();
    if (tabName === 'engagement') renderEngagement();
    if (tabName === 'responses') loadResponses();
}

// ---- Recipients ----

async function loadRecipients() {
    if (allRecipients.length === 0) {
        try {
            const res = await fetch(`${API_BASE}/broadcast/${campaignId}/recipients?page=1&limit=1000`, { headers: getHeaders() });
            if (!res.ok) throw new Error('Erro');
            const data = await res.json();
            allRecipients = data.data || [];
        } catch (e) {
            alert('Erro ao carregar destinatarios: ' + e.message);
            return;
        }
    }
    setupRecipientsFilters();
    applyRecipientsFilters();
    renderRecipientsPaginated(1);
}

function applyRecipientsFilters() {
    filteredRecipients = allRecipients.filter(r => {
        const matchesStatus = !recipientStatusFilter || r.status === recipientStatusFilter;
        const matchesSearch = !recipientSearchTerm ||
            r.name?.toLowerCase().includes(recipientSearchTerm.toLowerCase()) ||
            r.phoneNumber?.includes(recipientSearchTerm);
        return matchesStatus && matchesSearch;
    });
}

function renderRecipientsPaginated(page = 1) {
    const pageSize = 50;
    const start = (page - 1) * pageSize;
    const paginated = filteredRecipients.slice(start, start + pageSize);
    recipientsPage = page;

    const table = document.getElementById('recipientsTable');
    if (!paginated.length) {
        table.innerHTML = '<p>Nenhum destinatario encontrado.</p>';
        return;
    }

    table.innerHTML = `
        <div class="text-muted" style="margin-bottom:10px">Mostrando ${paginated.length} de ${filteredRecipients.length} destinatarios</div>
        <div class="table-container"><table>
            <thead><tr>
                <th>Nome</th><th>Telefone</th><th>Status</th><th>Enviado</th><th>Entregue</th><th>Lido</th><th>Respondeu</th><th>Opt-out</th><th>Erro</th>
            </tr></thead>
            <tbody>${paginated.map(r => {
                const msg = r.messages?.[0];
                return `<tr>
                    <td>${r.name || 'N/A'}</td>
                    <td>${r.phoneNumber}</td>
                    <td><span class="status-badge status-${r.status}">${r.status}</span></td>
                    <td>${msg?.sentAt ? new Date(msg.sentAt).toLocaleString('pt-BR') : '-'}</td>
                    <td>${msg?.deliveredAt ? new Date(msg.deliveredAt).toLocaleString('pt-BR') : '-'}</td>
                    <td>${msg?.readAt ? new Date(msg.readAt).toLocaleString('pt-BR') : '-'}</td>
                    <td>${r.respondedAt ? new Date(r.respondedAt).toLocaleString('pt-BR') : '-'}</td>
                    <td>${r.optedOut ? `<span class="tag-badge tag-danger">${r.optOutReason || 'Sim'}</span>` : '-'}</td>
                    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${msg?.errorMessage || ''}">${msg?.errorMessage || '-'}</td>
                </tr>`;
            }).join('')}</tbody>
        </table></div>
    `;

    const totalPages = Math.ceil(filteredRecipients.length / pageSize);
    document.getElementById('pageInfoRecipients').textContent = `Pagina ${page} de ${totalPages}`;
    document.getElementById('prevPageRecipients').disabled = page <= 1;
    document.getElementById('nextPageRecipients').disabled = page >= totalPages;
}

function previousPageRecipients() { if (recipientsPage > 1) renderRecipientsPaginated(recipientsPage - 1); }
function nextPageRecipients() { renderRecipientsPaginated(recipientsPage + 1); }

function setupRecipientsFilters() {
    const search = document.getElementById('recipientSearch');
    const status = document.getElementById('recipientStatusFilter');
    if (search && !search._bound) {
        search.addEventListener('input', e => { recipientSearchTerm = e.target.value; applyRecipientsFilters(); renderRecipientsPaginated(1); });
        search._bound = true;
    }
    if (status && !status._bound) {
        status.addEventListener('change', e => { recipientStatusFilter = e.target.value; applyRecipientsFilters(); renderRecipientsPaginated(1); });
        status._bound = true;
    }
}

function exportRecipients() {
    if (!filteredRecipients.length) { alert('Nenhum destinatario para exportar'); return; }
    const headers = ['Nome','Telefone','Status','Ativo','Enviado Em','Entregue Em','Lido Em','Respondeu Em','Opt-out','Motivo Opt-out','Falha Em','Codigo Erro','Mensagem Erro'];
    const rows = filteredRecipients.map(r => {
        const msg = r.messages?.[0];
        return [r.name||'', r.phoneNumber||'', r.status||'', r.isActive?'Sim':'Nao',
            msg?.sentAt ? new Date(msg.sentAt).toLocaleString('pt-BR') : '',
            msg?.deliveredAt ? new Date(msg.deliveredAt).toLocaleString('pt-BR') : '',
            msg?.readAt ? new Date(msg.readAt).toLocaleString('pt-BR') : '',
            r.respondedAt ? new Date(r.respondedAt).toLocaleString('pt-BR') : '',
            r.optedOut ? 'Sim' : 'Nao', r.optOutReason || '',
            msg?.failedAt ? new Date(msg.failedAt).toLocaleString('pt-BR') : '',
            msg?.errorCode||'', (msg?.errorMessage||'').replace(/"/g,'""')
        ];
    });
    const csv = [headers.map(h=>`"${h}"`).join(','), ...rows.map(row=>row.map(c=>`"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `campanha-${campaignId.substring(0,8)}-destinatarios-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// ---- Errors ----

async function loadErrorsAnalysis() {
    const container = document.getElementById('errorsAnalysis');
    container.innerHTML = '<p>Carregando...</p>';

    try {
        if (allRecipients.length === 0) {
            const res = await fetch(`${API_BASE}/broadcast/${campaignId}/recipients?page=1&limit=1000`, { headers: getHeaders() });
            if (!res.ok) throw new Error('Erro');
            allRecipients = (await res.json()).data || [];
        }

        const errorCodes = {};
        const errorMessages = {};
        let withDetails = 0, withoutDetails = 0;

        for (const r of allRecipients) {
            if (r.status === 'FAILED' || !r.isActive) {
                const msg = r.messages?.find(m => m.status === 'FAILED');
                if (msg?.errorCode) {
                    withDetails++;
                    errorCodes[msg.errorCode] = (errorCodes[msg.errorCode] || 0) + 1;
                    const key = msg.errorMessage || 'Sem mensagem';
                    errorMessages[key] = (errorMessages[key] || 0) + 1;
                } else {
                    withoutDetails++;
                }
            }
        }

        const sortedMessages = Object.entries(errorMessages).sort((a,b) => b[1] - a[1]).slice(0, 10);

        container.innerHTML = `
            <div style="display:grid;gap:20px">
                <div>
                    <h4>Resumo</h4>
                    <div class="stat-item"><span>Total analisado</span><strong>${allRecipients.length}</strong></div>
                    <div class="stat-item"><span>Falhas com detalhes</span><strong>${withDetails}</strong></div>
                    <div class="stat-item"><span>Falhas sem detalhes</span><strong>${withoutDetails}</strong></div>
                </div>
                ${Object.keys(errorCodes).length ? `<div><h4>Codigos de Erro</h4>${Object.entries(errorCodes).sort((a,b)=>b[1]-a[1]).map(([c,n])=>`<div class="stat-item"><span>${c}</span><strong>${n}</strong></div>`).join('')}</div>` : ''}
                ${sortedMessages.length ? `<div><h4>Mensagens de Erro (top 10)</h4>${sortedMessages.map(([m,n])=>`<div class="stat-item"><span style="max-width:400px;overflow:hidden;text-overflow:ellipsis" title="${m}">${m}</span><strong>${n}</strong></div>`).join('')}</div>` : ''}
            </div>
        `;
    } catch (e) {
        container.innerHTML = `<p style="color:var(--danger)">Erro: ${e.message}</p>`;
    }
}

// ---- Engagement ----

function renderEngagement() {
    const hourly = document.getElementById('hourlyEngagement');
    const best = document.getElementById('bestHours');

    if (!stats.engagement) {
        hourly.innerHTML = '<p class="text-muted">Sem dados de engajamento</p>';
        best.innerHTML = '<p class="text-muted">Sem dados</p>';
        return;
    }

    const activeHours = (stats.engagement.hourlyDistribution || []).filter(h => h.engagementScore > 0);

    hourly.innerHTML = activeHours.length ? activeHours.map(h => `
        <div class="stat-item">
            <span>${String(h.hour).padStart(2,'0')}:00</span>
            <span>Leituras: ${h.reads} | Respostas: ${h.responses} | Score: ${h.engagementScore}</span>
        </div>
    `).join('') : '<p class="text-muted">Sem engajamento registrado</p>';

    const bestHours = stats.engagement.bestHours || [];
    best.innerHTML = bestHours.length ? bestHours.map((h, i) => `
        <div class="stat-item">
            <span>${i + 1}. ${String(h.hour).padStart(2,'0')}:00</span>
            <strong>Score: ${h.engagementScore}</strong>
        </div>
    `).join('') : '<p class="text-muted">Sem dados</p>';

    // Button clicks
    if (stats.engagement.buttonClicks?.total > 0) {
        const bc = stats.engagement.buttonClicks;
        hourly.innerHTML += `
            <div style="margin-top:20px;padding-top:15px;border-top:1px solid var(--border)">
                <h4>Cliques em Botoes</h4>
                <div class="stat-item"><span>Total de cliques</span><strong>${bc.total}</strong></div>
                <div class="stat-item"><span>Contatos unicos</span><strong>${bc.uniqueContacts}</strong></div>
                <div class="stat-item"><span>Taxa de clique</span><strong>${bc.rate || '0%'}</strong></div>
            </div>
        `;
    }
}

// ---- Responses tab ----

async function loadResponses() {
    const container = document.getElementById('responsesContent');
    container.innerHTML = '<p>Carregando respostas...</p>';

    const responded = campaign.respondedCount || 0;
    const responses = campaign.responsesCount || 0;
    const optOut = campaign.optOutCount || 0;

    // Try to get response data from recipients
    if (allRecipients.length === 0) {
        try {
            const res = await fetch(`${API_BASE}/broadcast/${campaignId}/recipients?page=1&limit=1000`, { headers: getHeaders() });
            if (res.ok) allRecipients = (await res.json()).data || [];
        } catch (e) { /* ignore */ }
    }

    const respondedRecipients = allRecipients.filter(r => r.respondedAt);
    const optOutRecipients = allRecipients.filter(r => r.optedOut);

    container.innerHTML = `
        <div style="display:grid;gap:20px">
            <div>
                <h4>Resumo de Respostas</h4>
                <div class="stat-item"><span>Total de respostas</span><strong>${responses}</strong></div>
                <div class="stat-item"><span>Contatos que responderam</span><strong>${responded}</strong></div>
                <div class="stat-item"><span>Opt-outs</span><strong>${optOut}</strong></div>
            </div>
            ${respondedRecipients.length ? `
            <div>
                <h4>Contatos que Responderam (${respondedRecipients.length})</h4>
                <div class="table-container"><table>
                    <thead><tr><th>Nome</th><th>Telefone</th><th>Respondeu em</th><th>Tempo de resposta</th><th>Qtd respostas</th></tr></thead>
                    <tbody>${respondedRecipients.slice(0, 50).map(r => {
                        const respTime = r.firstResponseTimeSeconds != null
                            ? r.firstResponseTimeSeconds < 60 ? Math.round(r.firstResponseTimeSeconds) + 's'
                            : r.firstResponseTimeSeconds < 3600 ? Math.round(r.firstResponseTimeSeconds / 60) + 'min'
                            : (r.firstResponseTimeSeconds / 3600).toFixed(1) + 'h'
                            : '--';
                        return `<tr>
                            <td>${r.name || 'N/A'}</td>
                            <td>${r.phoneNumber}</td>
                            <td>${new Date(r.respondedAt).toLocaleString('pt-BR')}</td>
                            <td>${respTime}</td>
                            <td>${r.responseCount || 1}</td>
                        </tr>`;
                    }).join('')}</tbody>
                </table></div>
                ${respondedRecipients.length > 50 ? `<p class="text-muted">Mostrando 50 de ${respondedRecipients.length}</p>` : ''}
            </div>` : ''}
            ${optOutRecipients.length ? `
            <div>
                <h4>Opt-outs (${optOutRecipients.length})</h4>
                <div class="table-container"><table>
                    <thead><tr><th>Nome</th><th>Telefone</th><th>Data</th><th>Motivo</th></tr></thead>
                    <tbody>${optOutRecipients.map(r => `<tr>
                        <td>${r.name || 'N/A'}</td>
                        <td>${r.phoneNumber}</td>
                        <td>${r.optedOutAt ? new Date(r.optedOutAt).toLocaleString('pt-BR') : '-'}</td>
                        <td><span class="tag-badge tag-danger">${r.optOutReason || 'N/A'}</span></td>
                    </tr>`).join('')}</tbody>
                </table></div>
            </div>` : ''}
        </div>
    `;
}

// ---- Actions ----

function updateActionButtons() {
    document.getElementById('pauseBtn').style.display = campaign.status === 'PROCESSING' ? 'inline-block' : 'none';
    document.getElementById('resumeBtn').style.display = campaign.status === 'PAUSED' ? 'inline-block' : 'none';
    document.getElementById('requeueBtn').style.display = ['PROCESSING', 'PAUSED'].includes(campaign.status) ? 'inline-block' : 'none';
    document.getElementById('cancelBtn').style.display = !['COMPLETED', 'CANCELED'].includes(campaign.status) ? 'inline-block' : 'none';
}

async function doAction(action, confirmMsg) {
    if (!confirm(confirmMsg)) return;
    try {
        const res = await fetch(`${API_BASE}/broadcast/${campaignId}/${action}`, { method: 'POST', headers: getHeaders() });
        if (!res.ok) throw new Error('Erro');
        location.reload();
    } catch (e) { alert('Erro: ' + e.message); }
}

function requeueCampaign() { doAction('requeue', 'Deseja reenfileirar esta campanha?'); }
function pauseCampaign() { doAction('pause', 'Deseja pausar esta campanha?'); }
function resumeCampaign() { doAction('resume', 'Deseja retomar esta campanha?'); }
function cancelCampaign() { doAction('cancel', 'Deseja cancelar esta campanha? Esta acao nao pode ser desfeita.'); }

// ---- Auto-refresh for PROCESSING campaigns ----

function manageAutoRefresh() {
    const indicator = document.getElementById('autoRefreshIndicator');

    if (campaign.status === 'PROCESSING') {
        indicator.style.display = 'block';
        if (!autoRefreshTimer) {
            autoRefreshTimer = setInterval(async () => {
                try {
                    const [cRes, sRes] = await Promise.all([
                        fetch(`${API_BASE}/broadcast/${campaignId}`, { headers: getHeaders() }),
                        fetch(`${API_BASE}/broadcast/${campaignId}/stats`, { headers: getHeaders() })
                    ]);
                    if (cRes.ok && sRes.ok) {
                        campaign = await cRes.json();
                        stats = await sRes.json();
                        renderCampaignHeader();
                        renderStats();
                        if (currentTab === 'overview') renderOverview();
                        updateActionButtons();

                        if (campaign.status !== 'PROCESSING') {
                            clearInterval(autoRefreshTimer);
                            autoRefreshTimer = null;
                            indicator.style.display = 'none';
                        }
                    }
                } catch (e) { /* silent */ }
            }, 10000);
        }
    } else {
        indicator.style.display = 'none';
        if (autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
        }
    }
}

// ---- Init ----

if (checkAuth()) {
    loadCampaignData();
}
