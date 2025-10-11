// API Configuration
const API_BASE_URL = 'http://localhost:3000/api';

// API Client
const api = {
    // Campaigns
    async getCampaigns(filters = {}) {
        const params = new URLSearchParams(filters);
        const response = await fetch(`${API_BASE_URL}/broadcast?${params}`);
        const result = await response.json();
        if (Array.isArray(result)) {
            return result;
        }
        return result?.data || [];
    },

    async getCampaign(id) {
        const response = await fetch(`${API_BASE_URL}/broadcast/${id}`);
        return response.json();
    },

    async createCampaign(data) {
        const response = await fetch(`${API_BASE_URL}/broadcast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return response.json();
    },

    async updateCampaign(id, data) {
        const response = await fetch(`${API_BASE_URL}/broadcast/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return response.json();
    },

    async deleteCampaign(id) {
        const response = await fetch(`${API_BASE_URL}/broadcast/${id}`, {
            method: 'DELETE'
        });
        return response.ok;
    },

    // Recipients
    async addRecipients(campaignId, recipients) {
        const response = await fetch(`${API_BASE_URL}/broadcast/${campaignId}/recipients`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipients })
        });
        return response.json();
    },

    async uploadRecipients(campaignId, file) {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch(`${API_BASE_URL}/broadcast/${campaignId}/recipients/upload`, {
            method: 'POST',
            body: formData
        });
        return response.json();
    },

    async getRecipients(campaignId, page = 1, limit = 50) {
        const response = await fetch(`${API_BASE_URL}/broadcast/${campaignId}/recipients?page=${page}&limit=${limit}`);
        return response.json();
    },

    // Campaign Control
    async startCampaign(id) {
        const response = await fetch(`${API_BASE_URL}/broadcast/${id}/start`, {
            method: 'POST'
        });
        return response.json();
    },

    async pauseCampaign(id) {
        const response = await fetch(`${API_BASE_URL}/broadcast/${id}/pause`, {
            method: 'POST'
        });
        return response.json();
    },

    async resumeCampaign(id) {
        const response = await fetch(`${API_BASE_URL}/broadcast/${id}/resume`, {
            method: 'POST'
        });
        return response.json();
    },

    async cancelCampaign(id) {
        const response = await fetch(`${API_BASE_URL}/broadcast/${id}/cancel`, {
            method: 'POST'
        });
        return response.json();
    },

    // Stats
    async getCampaignStats(id) {
        const response = await fetch(`${API_BASE_URL}/broadcast/${id}/stats`);
        return response.json();
    },

    // Queue Stats
    async getQueueStats() {
        const response = await fetch(`${API_BASE_URL}/queue/stats`);
        return response.json();
    }
};
