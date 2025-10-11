// Campaigns Page
const CampaignsPage = {
    currentFilters: {},
    currentPage: 1,

    async render() {
        const content = document.getElementById('content-area');
        
        content.innerHTML = `
            <!-- Filters -->
            <div class="card mb-6">
                <div class="flex flex-wrap gap-4">
                    <div class="flex-1 min-w-[200px]">
                        <input 
                            type="text" 
                            id="search-name" 
                            placeholder="Buscar por nome..." 
                            class="form-input"
                        >
                    </div>
                    <div class="w-48">
                        <select id="filter-status" class="form-select">
                            <option value="">Todos os Status</option>
                            <option value="DRAFT">Rascunho</option>
                            <option value="SCHEDULED">Agendada</option>
                            <option value="PROCESSING">Processando</option>
                            <option value="COMPLETED">Concluída</option>
                            <option value="PAUSED">Pausada</option>
                            <option value="CANCELED">Cancelada</option>
                        </select>
                    </div>
                    <button onclick="CampaignsPage.clearFilters()" class="btn btn-secondary">
                        <i class="fas fa-redo"></i>
                        Limpar
                    </button>
                </div>
            </div>

            <!-- Campaigns List -->
            <div id="campaigns-list"></div>
        `;

        // Add event listeners
        document.getElementById('search-name').addEventListener('input', 
            debounce(() => this.applyFilters(), 500)
        );
        
        document.getElementById('filter-status').addEventListener('change', 
            () => this.applyFilters()
        );

        await this.loadCampaigns();
    },

    async loadCampaigns() {
        showLoading();
        try {
            const campaigns = await api.getCampaigns(this.currentFilters);
            this.renderCampaigns(campaigns);
        } catch (error) {
            showToast('Erro ao carregar campanhas', 'error');
            console.error(error);
        } finally {
            hideLoading();
        }
    },

    renderCampaigns(campaigns) {
        const container = document.getElementById('campaigns-list');

        if (campaigns.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox empty-state-icon"></i>
                    <h3 class="empty-state-title">Nenhuma campanha encontrada</h3>
                    <p class="empty-state-text">Crie sua primeira campanha para começar</p>
                    <button onclick="App.navigateTo('create')" class="btn btn-primary mt-4">
                        <i class="fas fa-plus"></i>
                        Nova Campanha
                    </button>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                ${campaigns.map(campaign => this.renderCampaignCard(campaign)).join('')}
            </div>
        `;
    },

    renderCampaignCard(campaign) {
        const progress = calculateProgress({
            totalRecipients: campaign.totalRecipients,
            sent: campaign.sentCount,
            failed: campaign.failedCount
        });

        return `
            <div class="card">
                <div class="card-header">
                    <h3 class="text-lg font-bold text-gray-800 truncate">${campaign.name}</h3>
                    ${getStatusBadge(campaign.status)}
                </div>

                <div class="space-y-3">
                    <div class="flex items-center text-sm text-gray-600">
                        <i class="fas fa-calendar mr-2 text-purple-600"></i>
                        <span>${formatDate(campaign.createdAt)}</span>
                    </div>

                    <div class="flex items-center text-sm text-gray-600">
                        <i class="fas fa-users mr-2 text-purple-600"></i>
                        <span>${formatNumber(campaign.totalRecipients)} contatos</span>
                    </div>

                    ${campaign.scheduledAt ? `
                        <div class="flex items-center text-sm text-gray-600">
                            <i class="fas fa-clock mr-2 text-purple-600"></i>
                            <span>Agendada para ${formatDate(campaign.scheduledAt)}</span>
                        </div>
                    ` : ''}

                    <!-- Progress Bar -->
                    ${campaign.status === 'PROCESSING' || campaign.status === 'COMPLETED' ? `
                        <div>
                            <div class="flex justify-between text-xs text-gray-600 mb-1">
                                <span>Progresso</span>
                                <span>${progress}%</span>
                            </div>
                            <div class="progress">
                                <div class="progress-bar progress-bar-success" style="width: ${progress}%"></div>
                            </div>
                        </div>

                        <div class="grid grid-cols-3 gap-2 text-center text-xs">
                            <div>
                                <div class="text-green-600 font-bold">${formatNumber(campaign.sentCount)}</div>
                                <div class="text-gray-500">Enviados</div>
                            </div>
                            <div>
                                <div class="text-blue-600 font-bold">${formatNumber(campaign.deliveredCount)}</div>
                                <div class="text-gray-500">Entregues</div>
                            </div>
                            <div>
                                <div class="text-red-600 font-bold">${formatNumber(campaign.failedCount)}</div>
                                <div class="text-gray-500">Falhas</div>
                            </div>
                        </div>
                    ` : ''}
                </div>

                <div class="mt-4 pt-4 border-t flex flex-wrap gap-2">
                    <button 
                        onclick="CampaignsPage.viewCampaign('${campaign.id}')" 
                        class="btn btn-primary btn-sm flex-1"
                    >
                        <i class="fas fa-eye"></i>
                        Ver Detalhes
                    </button>

                    ${campaign.status === 'DRAFT' ? `
                        <button 
                            onclick="CampaignsPage.startCampaign('${campaign.id}')" 
                            class="btn btn-success btn-sm"
                        >
                            <i class="fas fa-play"></i>
                        </button>
                    ` : ''}

                    ${campaign.status === 'PROCESSING' ? `
                        <button 
                            onclick="CampaignsPage.pauseCampaign('${campaign.id}')" 
                            class="btn btn-warning btn-sm"
                        >
                            <i class="fas fa-pause"></i>
                        </button>
                    ` : ''}

                    ${campaign.status === 'PAUSED' ? `
                        <button 
                            onclick="CampaignsPage.resumeCampaign('${campaign.id}')" 
                            class="btn btn-success btn-sm"
                        >
                            <i class="fas fa-play"></i>
                        </button>
                    ` : ''}

                    <button 
                        onclick="CampaignsPage.deleteCampaign('${campaign.id}')" 
                        class="btn btn-danger btn-sm"
                    >
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    },

    applyFilters() {
        const name = document.getElementById('search-name').value;
        const status = document.getElementById('filter-status').value;

        this.currentFilters = {};
        if (name) this.currentFilters.name = name;
        if (status) this.currentFilters.status = status;

        this.loadCampaigns();
    },

    clearFilters() {
        document.getElementById('search-name').value = '';
        document.getElementById('filter-status').value = '';
        this.currentFilters = {};
        this.loadCampaigns();
    },

    async viewCampaign(id) {
        showLoading();
        try {
            const campaign = await api.getCampaign(id);
            const stats = await api.getCampaignStats(id);
            this.showCampaignModal(campaign, stats);
        } catch (error) {
            showToast('Erro ao carregar detalhes', 'error');
        } finally {
            hideLoading();
        }
    },

    showCampaignModal(campaign, stats) {
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="text-xl font-bold text-gray-800">${campaign.name}</h3>
                    <button onclick="this.closest('.modal').remove()" class="text-gray-500 hover:text-gray-700">
                        <i class="fas fa-times text-2xl"></i>
                    </button>
                </div>

                <div class="modal-body">
                    <!-- Status -->
                    <div class="mb-6">
                        ${getStatusBadge(campaign.status)}
                    </div>

                    <!-- Stats Grid -->
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div class="stat-card">
                            <div class="stat-icon stat-icon-primary">
                                <i class="fas fa-users"></i>
                            </div>
                            <div>
                                <div class="text-2xl font-bold">${formatNumber(stats.totalRecipients)}</div>
                                <div class="text-sm text-gray-500">Total</div>
                            </div>
                        </div>

                        <div class="stat-card">
                            <div class="stat-icon stat-icon-success">
                                <i class="fas fa-check"></i>
                            </div>
                            <div>
                                <div class="text-2xl font-bold">${formatNumber(stats.sent)}</div>
                                <div class="text-sm text-gray-500">Enviados</div>
                            </div>
                        </div>

                        <div class="stat-card">
                            <div class="stat-icon stat-icon-success">
                                <i class="fas fa-check-double"></i>
                            </div>
                            <div>
                                <div class="text-2xl font-bold">${formatNumber(stats.delivered)}</div>
                                <div class="text-sm text-gray-500">Entregues</div>
                            </div>
                        </div>

                        <div class="stat-card">
                            <div class="stat-icon stat-icon-danger">
                                <i class="fas fa-times"></i>
                            </div>
                            <div>
                                <div class="text-2xl font-bold">${formatNumber(stats.failed)}</div>
                                <div class="text-sm text-gray-500">Falhas</div>
                            </div>
                        </div>
                    </div>

                    <!-- Rates -->
                    <div class="grid grid-cols-3 gap-4 mb-6">
                        <div class="text-center p-4 bg-green-50 rounded-lg">
                            <div class="text-3xl font-bold text-green-600">${stats.successRate?.toFixed(1) || 0}%</div>
                            <div class="text-sm text-gray-600">Taxa de Sucesso</div>
                        </div>
                        <div class="text-center p-4 bg-blue-50 rounded-lg">
                            <div class="text-3xl font-bold text-blue-600">${stats.deliveryRate?.toFixed(1) || 0}%</div>
                            <div class="text-sm text-gray-600">Taxa de Entrega</div>
                        </div>
                        <div class="text-center p-4 bg-red-50 rounded-lg">
                            <div class="text-3xl font-bold text-red-600">${stats.failureRate?.toFixed(1) || 0}%</div>
                            <div class="text-sm text-gray-600">Taxa de Falha</div>
                        </div>
                    </div>

                    <!-- Template Info -->
                    <div class="bg-gray-50 p-4 rounded-lg mb-6">
                        <h4 class="font-semibold text-gray-700 mb-2">Template</h4>
                        <div class="text-sm text-gray-600">
                            <div><strong>ID:</strong> ${campaign.templateId}</div>
                            <div><strong>Idioma:</strong> ${campaign.templateData?.language || 'pt_BR'}</div>
                        </div>
                    </div>

                    <!-- Dates -->
                    <div class="text-sm text-gray-600 space-y-2">
                        <div><strong>Criada em:</strong> ${formatDate(campaign.createdAt)}</div>
                        ${campaign.scheduledAt ? `<div><strong>Agendada para:</strong> ${formatDate(campaign.scheduledAt)}</div>` : ''}
                        ${campaign.startedAt ? `<div><strong>Iniciada em:</strong> ${formatDate(campaign.startedAt)}</div>` : ''}
                        ${campaign.completedAt ? `<div><strong>Concluída em:</strong> ${formatDate(campaign.completedAt)}</div>` : ''}
                    </div>
                </div>

                <div class="modal-footer">
                    <button onclick="this.closest('.modal').remove()" class="btn btn-secondary">
                        Fechar
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },

    async startCampaign(id) {
        if (!confirm('Deseja iniciar esta campanha?')) return;

        showLoading();
        try {
            await api.startCampaign(id);
            showToast('Campanha iniciada com sucesso!', 'success');
            this.loadCampaigns();
        } catch (error) {
            showToast('Erro ao iniciar campanha', 'error');
        } finally {
            hideLoading();
        }
    },

    async pauseCampaign(id) {
        if (!confirm('Deseja pausar esta campanha?')) return;

        showLoading();
        try {
            await api.pauseCampaign(id);
            showToast('Campanha pausada com sucesso!', 'success');
            this.loadCampaigns();
        } catch (error) {
            showToast('Erro ao pausar campanha', 'error');
        } finally {
            hideLoading();
        }
    },

    async resumeCampaign(id) {
        if (!confirm('Deseja retomar esta campanha?')) return;

        showLoading();
        try {
            await api.resumeCampaign(id);
            showToast('Campanha retomada com sucesso!', 'success');
            this.loadCampaigns();
        } catch (error) {
            showToast('Erro ao retomar campanha', 'error');
        } finally {
            hideLoading();
        }
    },

    async deleteCampaign(id) {
        if (!confirm('Deseja realmente excluir esta campanha? Esta ação não pode ser desfeita.')) return;

        showLoading();
        try {
            await api.deleteCampaign(id);
            showToast('Campanha excluída com sucesso!', 'success');
            this.loadCampaigns();
        } catch (error) {
            showToast('Erro ao excluir campanha', 'error');
        } finally {
            hideLoading();
        }
    }
};
