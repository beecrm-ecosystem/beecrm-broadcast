const API_BASE = window.location.origin + '/api';

// Verifica autenticação
function checkAuth() {
    const token = localStorage.getItem('broadcast_token');
    const username = localStorage.getItem('broadcast_username');
    
    if (!token || !username) {
        if (window.location.pathname.includes('dashboard') && !window.location.pathname.includes('index.html')) {
            window.location.href = '/dashboard/index.html';
        }
        return false;
    }
    return true;
}

// Login
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('errorMessage');
    
    // Autenticação simples (você pode melhorar isso com um endpoint real)
    // Por enquanto, aceita qualquer usuário com senha 'admin'
    if (password === 'beecrm2024' || password === 'admin') {
        localStorage.setItem('broadcast_token', btoa(username + ':' + password));
        localStorage.setItem('broadcast_username', username);
        window.location.href = '/dashboard/overview.html';
    } else {
        errorMessage.textContent = 'Credenciais inválidas';
        errorMessage.classList.add('active');
    }
});

// Logout
function logout() {
    localStorage.removeItem('broadcast_token');
    localStorage.removeItem('broadcast_username');
    window.location.href = '/dashboard/index.html';
}

// Atualiza info do usuário
function updateUserInfo() {
    const username = localStorage.getItem('broadcast_username');
    const userInfo = document.getElementById('userInfo');
    if (userInfo && username) {
        userInfo.textContent = `👤 ${username}`;
    }
}

// Headers com autenticação
function getHeaders() {
    return {
        'Content-Type': 'application/json',
        // Adicione aqui headers de autenticação se necessário
    };
}

// Chama no carregamento
if (checkAuth()) {
    updateUserInfo();
}
