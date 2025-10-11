// Create Campaign Page
const CreatePage = {
    async render() {
        const content = document.getElementById('content-area');
        
        content.innerHTML = `
            <div class="max-w-4xl mx-auto">
                <div class="card">
                    <h3 class="text-xl font-bold text-gray-800 mb-6">Criar Nova Campanha</h3>

                    <form id="create-campaign-form" class="space-y-6">
                        <!-- Basic Info -->
                        <div class="form-group">
                            <label class="form-label">Nome da Campanha *</label>
                            <input 
                                type="text" 
                                name="name" 
                                class="form-input" 
                                placeholder="Ex: Campanha Black Friday 2025"
                                required
                            >
                        </div>

                        <div class="form-group">
                            <label class="form-label">Canal do WhatsApp *</label>
                            <input 
                                type="text" 
                                name="channel" 
                                class="form-input" 
                                placeholder="Ex: whatsapp"
                                required
                            >
                            <p class="text-sm text-gray-500 mt-1">ID do canal configurado no Diogenes</p>
                        </div>

                        <!-- Template -->
                        <div class="form-group">
                            <label class="form-label">ID do Template *</label>
                            <input 
                                type="text" 
                                name="templateId" 
                                class="form-input" 
                                placeholder="Ex: black_friday_offer"
                                required
                            >
                        </div>

                        <div class="form-group">
                            <label class="form-label">Idioma do Template</label>
                            <select name="language" class="form-select">
                                <option value="pt_BR">Português (Brasil)</option>
                                <option value="en_US">Inglês (EUA)</option>
                                <option value="es_ES">Espanhol (Espanha)</option>
                            </select>
                        </div>

                        <!-- Template Components -->
                        <div class="form-group">
                            <label class="form-label">Componentes do Template (JSON)</label>
                            <textarea 
                                name="components" 
                                class="form-textarea" 
                                rows="8"
                                placeholder='[
  {
    "type": "BODY",
    "parameters": [
      { "type": "text", "text": "{{1}}" },
      { "type": "text", "text": "{{2}}" }
    ]
  }
]'
                            ></textarea>
                            <p class="text-sm text-gray-500 mt-1">
                                Formato JSON dos componentes. Use {{1}}, {{2}}, etc. para variáveis.
                            </p>
                        </div>

                        <!-- Scheduling -->
                        <div class="form-group">
                            <label class="form-label">Agendar Para (opcional)</label>
                            <input 
                                type="datetime-local" 
                                name="scheduledAt" 
                                class="form-input"
                            >
                        </div>

                        <!-- Queue Config -->
                        <div class="bg-gray-50 p-4 rounded-lg space-y-4">
                            <h4 class="font-semibold text-gray-700">Configurações de Fila</h4>
                            
                            <div class="grid grid-cols-2 gap-4">
                                <div class="form-group">
                                    <label class="form-label">Tamanho do Lote</label>
                                    <input 
                                        type="number" 
                                        name="batchSize" 
                                        class="form-input" 
                                        value="100"
                                        min="1"
                                        max="1000"
                                    >
                                    <p class="text-sm text-gray-500 mt-1">Mensagens por lote</p>
                                </div>

                                <div class="form-group">
                                    <label class="form-label">Delay entre Lotes (ms)</label>
                                    <input 
                                        type="number" 
                                        name="batchDelay" 
                                        class="form-input" 
                                        value="1000"
                                        min="0"
                                        step="100"
                                    >
                                    <p class="text-sm text-gray-500 mt-1">Pausa entre lotes</p>
                                </div>
                            </div>
                        </div>

                        <!-- Buttons -->
                        <div class="flex justify-end space-x-3">
                            <button 
                                type="button" 
                                onclick="App.navigateTo('campaigns')" 
                                class="btn btn-secondary"
                            >
                                Cancelar
                            </button>
                            <button type="submit" class="btn btn-primary">
                                <i class="fas fa-save"></i>
                                Criar Campanha
                            </button>
                        </div>
                    </form>
                </div>

                <!-- Add Recipients Section -->
                <div id="recipients-section" class="hidden mt-6">
                    <div class="card">
                        <h3 class="text-xl font-bold text-gray-800 mb-6">Adicionar Contatos</h3>

                        <!-- Tabs -->
                        <div class="flex border-b mb-6">
                            <button 
                                class="tab-button active" 
                                data-tab="manual"
                                onclick="CreatePage.switchTab('manual')"
                            >
                                <i class="fas fa-keyboard mr-2"></i>
                                Manual
                            </button>
                            <button 
                                class="tab-button" 
                                data-tab="file"
                                onclick="CreatePage.switchTab('file')"
                            >
                                <i class="fas fa-file-upload mr-2"></i>
                                Upload de Arquivo
                            </button>
                        </div>

                        <!-- Manual Tab -->
                        <div id="tab-manual" class="tab-content">
                            <form id="add-recipients-form">
                                <div class="form-group">
                                    <label class="form-label">Contatos (JSON Array)</label>
                                    <textarea 
                                        name="recipients" 
                                        class="form-textarea" 
                                        rows="10"
                                        placeholder='[
  {
    "phone": "+5511999999999",
    "name": "João Silva",
    "variables": {
      "nome": "João",
      "produto": "Premium"
    }
  }
]'
                                    ></textarea>
                                </div>

                                <button type="submit" class="btn btn-primary">
                                    <i class="fas fa-user-plus"></i>
                                    Adicionar Contatos
                                </button>
                            </form>
                        </div>

                        <!-- File Tab -->
                        <div id="tab-file" class="tab-content hidden">
                            <form id="upload-recipients-form">
                                <div 
                                    id="file-drop-zone" 
                                    class="file-upload"
                                >
                                    <i class="fas fa-cloud-upload-alt text-5xl text-gray-400 mb-3"></i>
                                    <p class="text-lg font-semibold text-gray-700 mb-2">
                                        Arraste um arquivo CSV ou XLSX aqui
                                    </p>
                                    <p class="text-sm text-gray-500 mb-4">ou clique para selecionar</p>
                                    <input 
                                        type="file" 
                                        id="file-input" 
                                        name="file" 
                                        accept=".csv,.xlsx,.xls"
                                        class="hidden"
                                    >
                                    <button 
                                        type="button" 
                                        onclick="document.getElementById('file-input').click()" 
                                        class="btn btn-primary"
                                    >
                                        <i class="fas fa-folder-open"></i>
                                        Selecionar Arquivo
                                    </button>
                                </div>

                                <div id="file-info" class="hidden mt-4 p-4 bg-blue-50 rounded-lg">
                                    <div class="flex items-center justify-between">
                                        <div class="flex items-center">
                                            <i class="fas fa-file text-blue-600 text-2xl mr-3"></i>
                                            <div>
                                                <p id="file-name" class="font-semibold text-gray-800"></p>
                                                <p id="file-size" class="text-sm text-gray-600"></p>
                                            </div>
                                        </div>
                                        <button 
                                            type="button" 
                                            onclick="CreatePage.clearFile()" 
                                            class="text-red-600 hover:text-red-800"
                                        >
                                            <i class="fas fa-times text-xl"></i>
                                        </button>
                                    </div>
                                </div>

                                <button 
                                    type="submit" 
                                    id="upload-button" 
                                    class="btn btn-primary mt-4 hidden"
                                >
                                    <i class="fas fa-upload"></i>
                                    Fazer Upload
                                </button>
                            </form>
                        </div>

                        <div class="mt-6 pt-6 border-t">
                            <button 
                                onclick="CreatePage.finishAndStart()" 
                                class="btn btn-success w-full"
                            >
                                <i class="fas fa-rocket"></i>
                                Finalizar e Iniciar Campanha
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.attachEventListeners();
    },

    attachEventListeners() {
        // Create campaign form
        document.getElementById('create-campaign-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.createCampaign();
        });

        // File upload
        const dropZone = document.getElementById('file-drop-zone');
        const fileInput = document.getElementById('file-input');

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                fileInput.files = files;
                this.showFileInfo(files[0]);
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.showFileInfo(e.target.files[0]);
            }
        });

        // Upload form
        document.getElementById('upload-recipients-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.uploadRecipients();
        });

        // Manual recipients form
        document.getElementById('add-recipients-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addRecipients();
        });
    },

    async createCampaign() {
        const form = document.getElementById('create-campaign-form');
        const formData = new FormData(form);

        try {
            // Parse components
            let components = [];
            const componentsText = formData.get('components');
            if (componentsText) {
                components = JSON.parse(componentsText);
            }

            const data = {
                name: formData.get('name'),
                channel: formData.get('channel'),
                templateId: formData.get('templateId'),
                templateData: {
                    language: formData.get('language'),
                    components: components
                },
                batchSize: parseInt(formData.get('batchSize')),
                batchDelay: parseInt(formData.get('batchDelay'))
            };

            if (formData.get('scheduledAt')) {
                data.scheduledAt = new Date(formData.get('scheduledAt')).toISOString();
            }

            showLoading();
            const campaign = await api.createCampaign(data);
            
            this.createdCampaignId = campaign.id;
            
            showToast('Campanha criada com sucesso!', 'success');
            
            // Show recipients section
            document.getElementById('recipients-section').classList.remove('hidden');
            document.getElementById('create-campaign-form').classList.add('hidden');
            
        } catch (error) {
            showToast('Erro ao criar campanha: ' + error.message, 'error');
            console.error(error);
        } finally {
            hideLoading();
        }
    },

    switchTab(tabName) {
        // Update buttons
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.tab === tabName) {
                btn.classList.add('active');
            }
        });

        // Update content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.add('hidden');
        });
        document.getElementById(`tab-${tabName}`).classList.remove('hidden');
    },

    showFileInfo(file) {
        document.getElementById('file-name').textContent = file.name;
        document.getElementById('file-size').textContent = 
            `${(file.size / 1024).toFixed(2)} KB`;
        document.getElementById('file-info').classList.remove('hidden');
        document.getElementById('upload-button').classList.remove('hidden');
    },

    clearFile() {
        document.getElementById('file-input').value = '';
        document.getElementById('file-info').classList.add('hidden');
        document.getElementById('upload-button').classList.add('hidden');
    },

    async uploadRecipients() {
        const fileInput = document.getElementById('file-input');
        if (!fileInput.files[0]) {
            showToast('Selecione um arquivo', 'warning');
            return;
        }

        showLoading();
        try {
            const result = await api.uploadRecipients(this.createdCampaignId, fileInput.files[0]);
            showToast(`${result.totalContacts} contatos adicionados à fila!`, 'success');
            this.clearFile();
        } catch (error) {
            showToast('Erro ao fazer upload: ' + error.message, 'error');
        } finally {
            hideLoading();
        }
    },

    async addRecipients() {
        const form = document.getElementById('add-recipients-form');
        const recipientsText = form.elements.recipients.value;

        try {
            const recipients = JSON.parse(recipientsText);
            
            showLoading();
            await api.addRecipients(this.createdCampaignId, recipients);
            showToast(`${recipients.length} contatos adicionados!`, 'success');
            form.reset();
        } catch (error) {
            showToast('Erro ao adicionar contatos: ' + error.message, 'error');
        } finally {
            hideLoading();
        }
    },

    async finishAndStart() {
        if (!confirm('Deseja finalizar a configuração e iniciar a campanha?')) return;

        showLoading();
        try {
            await api.startCampaign(this.createdCampaignId);
            showToast('Campanha iniciada com sucesso!', 'success');
            setTimeout(() => {
                App.navigateTo('campaigns');
            }, 1500);
        } catch (error) {
            showToast('Erro ao iniciar campanha: ' + error.message, 'error');
        } finally {
            hideLoading();
        }
    }
};

// Tab button styles
const style = document.createElement('style');
style.textContent = `
    .tab-button {
        padding: 12px 24px;
        border-bottom: 3px solid transparent;
        color: #6b7280;
        font-weight: 500;
        transition: all 0.2s;
    }
    .tab-button:hover {
        color: #7c3aed;
    }
    .tab-button.active {
        color: #7c3aed;
        border-bottom-color: #7c3aed;
    }
`;
document.head.appendChild(style);
