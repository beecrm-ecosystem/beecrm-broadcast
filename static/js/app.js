// Main Application
const App = {
    currentPage: 'campaigns',

    init() {
        // Setup navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.dataset.page;
                this.navigateTo(page);
            });
        });

        // Load initial page
        this.navigateTo('campaigns');
    },

    async navigateTo(page) {
        // Cleanup previous page
        if (this.currentPage === 'queue' && QueuePage.intervalId) {
            QueuePage.cleanup();
        }

        this.currentPage = page;

        // Update navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
            if (link.dataset.page === page) {
                link.classList.add('active');
            }
        });

        // Update title
        const titles = {
            campaigns: 'Campanhas de Broadcast',
            create: 'Nova Campanha',
            queue: 'Monitoramento de Filas',
            stats: 'Estatísticas Gerais'
        };

        const subtitles = {
            campaigns: 'Gerencie suas campanhas de WhatsApp',
            create: 'Configure uma nova campanha de broadcast',
            queue: 'Acompanhe o processamento em tempo real',
            stats: 'Análise de desempenho das campanhas'
        };

        document.getElementById('page-title').textContent = titles[page];
        document.getElementById('page-subtitle').textContent = subtitles[page];

        // Render page
        const pages = {
            campaigns: CampaignsPage,
            create: CreatePage,
            queue: QueuePage,
            stats: StatsPage
        };

        if (pages[page]) {
            await pages[page].render();
        }
    }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

// Global error handler
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
    showToast('Ocorreu um erro inesperado', 'error');
});

// Handle fetch errors
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled rejection:', event.reason);
    if (event.reason instanceof Error) {
        showToast('Erro de conexão: ' + event.reason.message, 'error');
    }
});
