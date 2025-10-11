// Queue Monitoring Page
const QueuePage = {
    intervalId: null,

    async render() {
        const content = document.getElementById('content-area');
        
        content.innerHTML = `
            <div class="mb-6 flex justify-between items-center">
                <div class="flex items-center space-x-3">
                    <button onclick="QueuePage.loadStats()" class="btn btn-secondary btn-sm">
                        <i class="fas fa-sync"></i>
                        Atualizar
                    </button>
                    <label class="flex items-center text-sm text-gray-600">
                        <input 
                            type="checkbox" 
                            id="auto-refresh" 
                            class="mr-2"
                            onchange="QueuePage.toggleAutoRefresh(this.checked)"
                        >
                        Atualizar automaticamente (5s)
                    </label>
                </div>
            </div>

            <!-- Queue Stats -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-6">
                <div class="stat-card">
                    <div class="stat-icon stat-icon-warning">
                        <i class="fas fa-clock"></i>
                    </div>
                    <div>
                        <div id="queue-waiting" class="text-2xl font-bold">-</div>
                        <div class="text-sm text-gray-500">Aguardando</div>
                    </div>
                </div>

                <div class="stat-card">
                    <div class="stat-icon stat-icon-primary">
                        <i class="fas fa-spinner"></i>
                    </div>
                    <div>
                        <div id="queue-active" class="text-2xl font-bold">-</div>
                        <div class="text-sm text-gray-500">Processando</div>
                    </div>
                </div>

                <div class="stat-card">
                    <div class="stat-icon stat-icon-success">
                        <i class="fas fa-check"></i>
                    </div>
                    <div>
                        <div id="queue-completed" class="text-2xl font-bold">-</div>
                        <div class="text-sm text-gray-500">Concluídos</div>
                    </div>
                </div>

                <div class="stat-card">
                    <div class="stat-icon stat-icon-danger">
                        <i class="fas fa-times"></i>
                    </div>
                    <div>
                        <div id="queue-failed" class="text-2xl font-bold">-</div>
                        <div class="text-sm text-gray-500">Falhas</div>
                    </div>
                </div>

                <div class="stat-card">
                    <div class="stat-icon bg-orange-100 text-orange-600">
                        <i class="fas fa-pause"></i>
                    </div>
                    <div>
                        <div id="queue-delayed" class="text-2xl font-bold">-</div>
                        <div class="text-sm text-gray-500">Atrasados</div>
                    </div>
                </div>
            </div>

            <!-- Active Campaigns -->
            <div class="card">
                <div class="card-header">
                    <h3 class="text-xl font-bold text-gray-800">
                        <i class="fas fa-broadcast-tower mr-2"></i>
                        Campanhas em Processamento
                    </h3>
                </div>
                <div id="active-campaigns"></div>
            </div>

            <!-- Recent Activity -->
            <div class="card mt-6">
                <div class="card-header">
                    <h3 class="text-xl font-bold text-gray-800">
                        <i class="fas fa-history mr-2"></i>
                        Atividade Recente
                    </h3>
                </div>
                <div id="recent-activity"></div>
            </div>
        `;

        await this.loadStats();
    },

    async loadStats() {
        try {
            // Load queue stats
            const queueStats = await api.getQueueStats();
            
            document.getElementById('queue-waiting').textContent = formatNumber(queueStats.waiting || 0);
            document.getElementById('queue-active').textContent = formatNumber(queueStats.active || 0);
            document.getElementById('queue-completed').textContent = formatNumber(queueStats.completed || 0);
            document.getElementById('queue-failed').textContent = formatNumber(queueStats.failed || 0);
            document.getElementById('queue-delayed').textContent = formatNumber(queueStats.delayed || 0);

            // Load active campaigns
            const campaigns = await api.getCampaigns({ status: 'PROCESSING' });
            this.renderActiveCampaigns(campaigns);

        } catch (error) {
            console.error('Error loading queue stats:', error);
        }
    },

    renderActiveCampaigns(campaigns) {
        const container = document.getElementById('active-campaigns');

        if (campaigns.length === 0) {
            container.innerHTML = `
                <div class="empty-state py-8">
                    <i class="fas fa-inbox empty-state-icon"></i>
                    <h3 class="empty-state-title">Nenhuma campanha em processamento</h3>
                    <p class="empty-state-text">As campanhas ativas aparecerão aqui</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="space-y-4">
                ${campaigns.map(campaign => this.renderActiveCampaign(campaign)).join('')}
            </div>
        `;
    },

    renderActiveCampaign(campaign) {
        const progress = calculateProgress({
            totalRecipients: campaign.totalRecipients,
            sent: campaign.sentCount,
            failed: campaign.failedCount
        });

        return `
            <div class="p-4 bg-gray-50 rounded-lg">
                <div class="flex items-center justify-between mb-3">
                    <h4 class="font-semibold text-gray-800">${campaign.name}</h4>
                    ${getStatusBadge(campaign.status)}
                </div>

                <div class="grid grid-cols-4 gap-4 mb-3 text-center text-sm">
                    <div>
                        <div class="text-gray-500">Total</div>
                        <div class="font-bold">${formatNumber(campaign.totalRecipients)}</div>
                    </div>
                    <div>
                        <div class="text-gray-500">Enviados</div>
                        <div class="font-bold text-green-600">${formatNumber(campaign.sentCount)}</div>
                    </div>
                    <div>
                        <div class="text-gray-500">Entregues</div>
                        <div class="font-bold text-blue-600">${formatNumber(campaign.deliveredCount)}</div>
                    </div>
                    <div>
                        <div class="text-gray-500">Falhas</div>
                        <div class="font-bold text-red-600">${formatNumber(campaign.failedCount)}</div>
                    </div>
                </div>

                <div>
                    <div class="flex justify-between text-xs text-gray-600 mb-1">
                        <span>Progresso</span>
                        <span>${progress}%</span>
                    </div>
                    <div class="progress">
                        <div class="progress-bar ${getProgressColor(progress)}" style="width: ${progress}%"></div>
                    </div>
                </div>

                <div class="flex justify-end space-x-2 mt-3">
                    <button 
                        onclick="CampaignsPage.viewCampaign('${campaign.id}')" 
                        class="btn btn-secondary btn-sm"
                    >
                        <i class="fas fa-eye"></i>
                        Ver Detalhes
                    </button>
                    <button 
                        onclick="CampaignsPage.pauseCampaign('${campaign.id}')" 
                        class="btn btn-warning btn-sm"
                    >
                        <i class="fas fa-pause"></i>
                        Pausar
                    </button>
                </div>
            </div>
        `;
    },

    toggleAutoRefresh(enabled) {
        if (enabled) {
            this.intervalId = setInterval(() => this.loadStats(), 5000);
            showToast('Atualização automática ativada', 'info');
        } else {
            if (this.intervalId) {
                clearInterval(this.intervalId);
                this.intervalId = null;
            }
            showToast('Atualização automática desativada', 'info');
        }
    },

    cleanup() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
};
