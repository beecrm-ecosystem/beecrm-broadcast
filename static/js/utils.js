// Utility Functions

// Show/Hide Loading
function showLoading() {
    document.getElementById('loading').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading').classList.add('hidden');
}

// Toast Notifications
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    const colors = {
        success: 'text-green-500',
        error: 'text-red-500',
        warning: 'text-yellow-500',
        info: 'text-blue-500'
    };
    
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="fas ${icons[type]} ${colors[type]} text-xl"></i>
        <span class="text-gray-700 font-medium">${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Format Date
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Format Number
function formatNumber(num) {
    return new Intl.NumberFormat('pt-BR').format(num);
}

// Get Status Badge
function getStatusBadge(status) {
    const badges = {
        DRAFT: '<span class="badge badge-draft"><i class="fas fa-pencil-alt mr-1"></i>Rascunho</span>',
        SCHEDULED: '<span class="badge badge-scheduled"><i class="fas fa-clock mr-1"></i>Agendada</span>',
        PROCESSING: '<span class="badge badge-processing"><i class="fas fa-spinner fa-spin mr-1"></i>Processando</span>',
        COMPLETED: '<span class="badge badge-completed"><i class="fas fa-check mr-1"></i>Concluída</span>',
        PAUSED: '<span class="badge badge-paused"><i class="fas fa-pause mr-1"></i>Pausada</span>',
        CANCELED: '<span class="badge badge-canceled"><i class="fas fa-times mr-1"></i>Cancelada</span>',
        FAILED: '<span class="badge badge-failed"><i class="fas fa-exclamation-triangle mr-1"></i>Falhou</span>'
    };
    return badges[status] || status;
}

// Confirm Dialog
function confirm(message) {
    return window.confirm(message);
}

// Debounce Function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Parse CSV
function parseCSV(text) {
    const lines = text.split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        
        const values = lines[i].split(',');
        const row = {};
        
        headers.forEach((header, index) => {
            row[header] = values[index]?.trim() || '';
        });
        
        if (row.NAME && row.PHONE) {
            data.push(row);
        }
    }
    
    return data;
}

// Download File
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Copy to Clipboard
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('Copiado para a área de transferência!', 'success');
    } catch (err) {
        showToast('Erro ao copiar', 'error');
    }
}

// Calculate Progress
function calculateProgress(stats) {
    const total = stats.totalRecipients || 1;
    const processed = (stats.sent || 0) + (stats.failed || 0);
    return Math.round((processed / total) * 100);
}

// Get Progress Color
function getProgressColor(percentage) {
    if (percentage < 30) return 'bg-red-500';
    if (percentage < 70) return 'bg-yellow-500';
    return 'bg-green-500';
}
