// Statistics Page
const StatsPage = {
    async render() {
        const content = document.getElementById('content-area');
        
        content.innerHTML = `
            <div class="mb-6">
                <button onclick="StatsPage.loadStats()" class="btn btn-secondary btn-sm">
                    <i class="fas fa-sync"></i>
                    Atualizar
                </button>
            </div>

            <!-- Overall Stats -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                <div class="stat-card">
                    <div class="stat-icon stat-icon-primary">
                        <i class="fas fa-bullhorn"></i>
                    </div>
                    <div>
                        <div id="total-campaigns" class="text-2xl font-bold">-</div>
                        <div class="text-sm text-gray-500">Total de Campanhas</div>
                    </div>
                </div>

                <div class="stat-card">
                    <div class="stat-icon stat-icon-success">
                        <i class="fas fa-paper-plane"></i>
                    </div>
                    <div>
                        <div id="total-sent" class="text-2xl font-bold">-</div>
                        <div class="text-sm text-gray-500">Mensagens Enviadas</div>
                    </div>
                </div>

                <div class="stat-card">
                    <div class="stat-icon stat-icon-success">
                        <i class="fas fa-check-double"></i>
                    </div>
                    <div>
                        <div id="total-delivered" class="text-2xl font-bold">-</div>
                        <div class="text-sm text-gray-500">Mensagens Entregues</div>
                    </div>
                </div>

                <div class="stat-card">
                    <div class="stat-icon stat-icon-danger">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <div>
                        <div id="total-failed" class="text-2xl font-bold">-</div>
                        <div class="text-sm text-gray-500">Falhas</div>
                    </div>
                </div>
            </div>

            <!-- Rates -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div class="card text-center">
                    <div class="text-5xl font-bold text-green-600 mb-2">
                        <span id="success-rate">-</span>%
                    </div>
                    <div class="text-gray-600 font-semibold">Taxa de Sucesso</div>
                    <p class="text-sm text-gray-500 mt-2">Mensagens enviadas com sucesso</p>
                </div>

                <div class="card text-center">
                    <div class="text-5xl font-bold text-blue-600 mb-2">
                        <span id="delivery-rate">-</span>%
                    </div>
                    <div class="text-gray-600 font-semibold">Taxa de Entrega</div>
                    <p class="text-sm text-gray-500 mt-2">Mensagens entregues ao destinatário</p>
                </div>

                <div class="card text-center">
                    <div class="text-5xl font-bold text-red-600 mb-2">
                        <span id="failure-rate">-</span>%
                    </div>
                    <div class="text-gray-600 font-semibold">Taxa de Falha</div>
                    <p class="text-sm text-gray-500 mt-2">Mensagens que falharam</p>
                </div>
            </div>

            <!-- Campaigns by Status -->
            <div class="card mb-6">
                <div class="card-header">
                    <h3 class="text-xl font-bold text-gray-800">
                        <i class="fas fa-chart-pie mr-2"></i>
                        Campanhas por Status
                    </h3>
                </div>
                <div id="campaigns-by-status"></div>
            </div>

            <!-- Top Campaigns -->
            <div class="card">
                <div class="card-header">
                    <h3 class="text-xl font-bold text-gray-800">
                        <i class="fas fa-trophy mr-2"></i>
                        Top 10 Campanhas
                    </h3>
                </div>
                <div id="top-campaigns"></div>
            </div>
        `;

        await this.loadStats();
    },

    async loadStats() {
        showLoading();
        try {
            const campaigns = await api.getCampaigns({});
            this.calculateOverallStats(campaigns);
            this.renderStatusBreakdown(campaigns);
            this.renderTopCampaigns(campaigns);
        } catch (error) {
            showToast('Erro ao carregar estatísticas', 'error');
            console.error(error);
        } finally {
            hideLoading();
        }
    },

    calculateOverallStats(campaigns) {
        const stats = {
            totalCampaigns: campaigns.length,
            totalSent: 0,
            totalDelivered: 0,
            totalFailed: 0,
            totalRecipients: 0
        };

        campaigns.forEach(campaign => {
            stats.totalSent += campaign.sentCount || 0;
            stats.totalDelivered += campaign.deliveredCount || 0;
            stats.totalFailed += campaign.failedCount || 0;
            stats.totalRecipients += campaign.totalRecipients || 0;
        });

        // Calculate rates
        const successRate = stats.totalRecipients > 0 
            ? (stats.totalSent / stats.totalRecipients * 100).toFixed(1)
            : 0;
        
        const deliveryRate = stats.totalSent > 0
            ? (stats.totalDelivered / stats.totalSent * 100).toFixed(1)
            : 0;
        
        const failureRate = stats.totalRecipients > 0
            ? (stats.totalFailed / stats.totalRecipients * 100).toFixed(1)
            : 0;

        // Update UI
        document.getElementById('total-campaigns').textContent = formatNumber(stats.totalCampaigns);
        document.getElementById('total-sent').textContent = formatNumber(stats.totalSent);
        document.getElementById('total-delivered').textContent = formatNumber(stats.totalDelivered);
        document.getElementById('total-failed').textContent = formatNumber(stats.totalFailed);
        document.getElementById('success-rate').textContent = successRate;
        document.getElementById('delivery-rate').textContent = deliveryRate;
        document.getElementById('failure-rate').textContent = failureRate;
    },

    renderStatusBreakdown(campaigns) {
        const statusCounts = {
            DRAFT: 0,
            SCHEDULED: 0,
            PROCESSING: 0,
            COMPLETED: 0,
            PAUSED: 0,
            CANCELED: 0,
            FAILED: 0
        };

        campaigns.forEach(campaign => {
            statusCounts[campaign.status] = (statusCounts[campaign.status] || 0) + 1;
        });

        const container = document.getElementById('campaigns-by-status');
        
        container.innerHTML = `
            <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                ${Object.entries(statusCounts).map(([status, count]) => `
                    <div class="text-center p-4 bg-gray-50 rounded-lg">
                        ${getStatusBadge(status)}
                        <div class="text-3xl font-bold text-gray-800 mt-2">${count}</div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    renderTopCampaigns(campaigns) {
        // Sort by sent count
        const topCampaigns = campaigns
            .filter(c => c.sentCount > 0)
            .sort((a, b) => b.sentCount - a.sentCount)
            .slice(0, 10);

        const container = document.getElementById('top-campaigns');

        if (topCampaigns.length === 0) {
            container.innerHTML = `
                <div class="empty-state py-8">
                    <i class="fas fa-chart-bar empty-state-icon"></i>
                    <h3 class="empty-state-title">Nenhuma campanha enviada ainda</h3>
                    <p class="empty-state-text">As campanhas com mais envios aparecerão aqui</p>
                </div>
            `;
            return;
        }

        const maxSent = topCampaigns[0].sentCount;

        container.innerHTML = `
            <div class="overflow-x-auto">
                <table class="table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Campanha</th>
                            <th>Status</th>
                            <th>Enviados</th>
                            <th>Entregues</th>
                            <th>Falhas</th>
                            <th>Taxa de Sucesso</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${topCampaigns.map((campaign, index) => {
                            const successRate = campaign.totalRecipients > 0
                                ? (campaign.sentCount / campaign.totalRecipients * 100).toFixed(1)
                                : 0;
                            
                            const barWidth = (campaign.sentCount / maxSent * 100).toFixed(1);
                            
                            return `
                                <tr>
                                    <td class="font-bold text-gray-600">${index + 1}</td>
                                    <td>
                                        <div class="font-semibold">${campaign.name}</div>
                                        <div class="text-xs text-gray-500">${formatDate(campaign.createdAt)}</div>
                                    </td>
                                    <td>${getStatusBadge(campaign.status)}</td>
                                    <td>
                                        <div class="font-bold">${formatNumber(campaign.sentCount)}</div>
                                        <div class="progress mt-1">
                                            <div class="progress-bar bg-green-500" style="width: ${barWidth}%"></div>
                                        </div>
                                    </td>
                                    <td class="text-blue-600 font-semibold">${formatNumber(campaign.deliveredCount)}</td>
                                    <td class="text-red-600 font-semibold">${formatNumber(campaign.failedCount)}</td>
                                    <td>
                                        <span class="badge ${successRate >= 90 ? 'badge-completed' : successRate >= 70 ? 'badge-processing' : 'badge-failed'}">
                                            ${successRate}%
                                        </span>
                                    </td>
                                    <td>
                                        <button 
                                            onclick="CampaignsPage.viewCampaign('${campaign.id}')" 
                                            class="btn btn-secondary btn-sm"
                                        >
                                            <i class="fas fa-eye"></i>
                                        </button>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }
};
