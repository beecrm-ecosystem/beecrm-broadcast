# 🎨 Painel Web - BeeCRM Broadcast

## 📋 Descrição

Painel web completo desenvolvido com **HTML**, **CSS (Tailwind CSS)** e **JavaScript Vanilla** para gerenciar campanhas de broadcast do WhatsApp.

## 🚀 Acesso

Após iniciar a aplicação, acesse:

```
http://localhost:3000/panel
```

## ✨ Funcionalidades

### 1. 📢 Campanhas

- **Listagem de Campanhas**: Visualize todas as campanhas com filtros por nome e status
- **Detalhes da Campanha**: Modal com informações completas, estatísticas e taxas
- **Controle de Execução**:
  - ▶️ Iniciar campanha (DRAFT → PROCESSING)
  - ⏸️ Pausar campanha em execução
  - ▶️ Retomar campanha pausada
  - 🗑️ Excluir campanha
- **Cards Informativos**: Progresso, contadores (enviados, entregues, falhas)
- **Busca e Filtros**: Pesquisa por nome, filtro por status

### 2. ➕ Nova Campanha

- **Formulário Completo**:
  - Nome da campanha
  - Canal do WhatsApp (ID do Diogenes)
  - ID do template
  - Idioma do template
  - Componentes do template (JSON)
  - Agendamento (opcional)
  - Configurações de fila (tamanho do lote, delay)

- **Adicionar Contatos - Dois Métodos**:

  **Método 1: Manual (JSON)**
  ```json
  [
    {
      "phone": "+5511999999999",
      "name": "João Silva",
      "variables": {
        "nome": "João",
        "produto": "Premium"
      }
    }
  ]
  ```

  **Método 2: Upload de Arquivo**
  - Suporta CSV, XLSX, XLS
  - Drag & drop ou seleção de arquivo
  - Tamanho máximo: 10MB
  - Processamento em filas (batches de 100)
  - Formato do CSV:
    ```csv
    NAME,PHONE,EMAIL,CF_CODCLIENTE,CF_CORINGA1
    João,+5511999999999,joao@email.com,12345,Valor1
    ```

- **Iniciar Campanha**: Botão para finalizar configuração e iniciar envio

### 3. 📊 Filas

- **Monitoramento em Tempo Real**:
  - ⏳ Aguardando
  - 🔄 Processando
  - ✅ Concluídos
  - ❌ Falhas
  - ⏸️ Atrasados

- **Campanhas Ativas**: Lista de campanhas em processamento com:
  - Progresso visual (barra de progresso)
  - Contadores atualizados
  - Ações rápidas (pausar, ver detalhes)

- **Atualização Automática**: Opção de auto-refresh a cada 5 segundos

### 4. 📈 Estatísticas

- **Visão Geral**:
  - Total de campanhas
  - Mensagens enviadas
  - Mensagens entregues
  - Total de falhas

- **Taxas Globais**:
  - 📊 Taxa de Sucesso (%)
  - 📊 Taxa de Entrega (%)
  - 📊 Taxa de Falha (%)

- **Campanhas por Status**: Breakdown visual de todas as campanhas

- **Top 10 Campanhas**: Ranking das campanhas com mais envios
  - Tabela completa com métricas
  - Barra de progresso visual
  - Taxa de sucesso individual

## 🎨 Design

### Interface
- **Sidebar Lateral**: Navegação fixa com logo e menu
- **Gradiente Roxo/Índigo**: Tema moderno e profissional
- **Cards Responsivos**: Layout adaptável (mobile, tablet, desktop)
- **Ícones Font Awesome**: Interface intuitiva e visual

### Componentes Visuais
- ✅ Status badges coloridos
- 📊 Barras de progresso animadas
- 🎯 Cards de estatísticas com ícones
- 🔔 Toast notifications (success, error, warning, info)
- 🪟 Modais informativos
- 📤 Upload drag & drop

### Cores por Status
- **DRAFT**: Cinza (Rascunho)
- **SCHEDULED**: Azul (Agendada)
- **PROCESSING**: Amarelo (Processando)
- **COMPLETED**: Verde (Concluída)
- **PAUSED**: Laranja (Pausada)
- **CANCELED**: Vermelho (Cancelada)
- **FAILED**: Vermelho (Falhou)

## 🔧 Tecnologias

### Frontend
- **HTML5**: Estrutura semântica
- **Tailwind CSS**: Framework CSS via CDN
- **JavaScript ES6+**: Vanilla JS modular
- **Font Awesome 6**: Ícones

### Arquitetura
- **Modular**: Cada página em arquivo separado
- **API Client**: Cliente HTTP centralizado
- **Utils**: Funções utilitárias reutilizáveis
- **SPA**: Single Page Application (navegação sem reload)

### Arquivos JavaScript
```
static/js/
├── api.js        # Cliente da API REST
├── utils.js      # Funções utilitárias
├── campaigns.js  # Página de campanhas
├── create.js     # Página de criação
├── queue.js      # Página de filas
├── stats.js      # Página de estatísticas
└── app.js        # Aplicação principal
```

## 📱 Responsividade

O painel é totalmente responsivo com breakpoints Tailwind:

- **Mobile**: < 768px (1 coluna)
- **Tablet**: 768px - 1024px (2 colunas)
- **Desktop**: > 1024px (3-4 colunas)

## 🚀 Como Usar

### 1. Iniciar Aplicação
```bash
npm run start:dev
```

### 2. Acessar Painel
```
http://localhost:3000/panel
```

### 3. Fluxo Típico

1. **Criar Campanha**:
   - Clique em "Nova Campanha"
   - Preencha nome, canal, template
   - Configure componentes e agendamento
   - Clique em "Criar Campanha"

2. **Adicionar Contatos**:
   - **Opção A**: Cole JSON manualmente
   - **Opção B**: Faça upload de CSV/XLSX
   - Aguarde processamento da fila

3. **Iniciar Envio**:
   - Clique em "Finalizar e Iniciar Campanha"
   - Acompanhe na página "Filas"

4. **Monitorar**:
   - Vá para "Filas" e ative auto-refresh
   - Ou veja estatísticas gerais em "Estatísticas"

## 🔍 Exemplos de Uso

### Criar Campanha Simples

```javascript
// Dados do formulário
{
  "name": "Black Friday 2025",
  "channel": "whatsapp",
  "templateId": "black_friday_offer",
  "templateData": {
    "language": "pt_BR",
    "components": [
      {
        "type": "BODY",
        "parameters": [
          { "type": "text", "text": "{{1}}" },
          { "type": "text", "text": "{{2}}" }
        ]
      }
    ]
  },
  "batchSize": 100,
  "batchDelay": 1000
}
```

### Adicionar Contatos (JSON)

```json
[
  {
    "phone": "+5511999999999",
    "name": "João Silva",
    "variables": {
      "nome": "João",
      "desconto": "50%"
    }
  },
  {
    "phone": "+5511988888888",
    "name": "Maria Santos",
    "variables": {
      "nome": "Maria",
      "desconto": "40%"
    }
  }
]
```

### Upload CSV

```csv
NAME,PHONE,EMAIL,CF_CODCLIENTE,CF_DESCONTO
João Silva,5511999999999,joao@email.com,12345,50%
Maria Santos,5511988888888,maria@email.com,67890,40%
```

**Resultado Automático**: CF_* vira variável
```json
{
  "phone": "+5511999999999",
  "name": "João Silva",
  "email": "joao@email.com",
  "variables": {
    "codcliente": "12345",
    "desconto": "50%"
  }
}
```

## 🎯 Features Avançadas

### Auto-refresh de Filas
```javascript
// Ativa atualização automática a cada 5s
document.getElementById('auto-refresh').checked = true;
```

### Toast Notifications
```javascript
showToast('Campanha criada com sucesso!', 'success');
showToast('Erro ao processar', 'error');
showToast('Atenção: verifique os dados', 'warning');
showToast('Processamento iniciado', 'info');
```

### Loading Overlay
```javascript
showLoading();  // Mostra overlay
hideLoading();  // Esconde overlay
```

### Formatação Automática
```javascript
formatDate('2025-01-15T10:30:00Z');  // "15/01/2025 10:30"
formatNumber(1234567);                // "1.234.567"
getStatusBadge('PROCESSING');         // HTML badge colorido
```

## 🔐 Configuração da API

O painel se conecta à API REST em:
```javascript
// static/js/api.js
const API_BASE_URL = 'http://localhost:3000';
```

Para alterar a URL da API, edite `static/js/api.js`.

## 📦 Estrutura de Arquivos

```
static/
├── index.html           # Página principal
├── css/
│   └── styles.css       # Estilos customizados
└── js/
    ├── api.js           # Cliente API
    ├── utils.js         # Utilitários
    ├── campaigns.js     # Página Campanhas
    ├── create.js        # Página Nova Campanha
    ├── queue.js         # Página Filas
    ├── stats.js         # Página Estatísticas
    └── app.js           # App principal
```

## 🐛 Troubleshooting

### Painel não carrega
- Verifique se a aplicação está rodando: `npm run start:dev`
- Acesse: `http://localhost:3000/panel` (não esqueça o `/panel`)

### API retorna erro 404
- Verifique se a API está rodando na porta 3000
- Confira `API_BASE_URL` em `static/js/api.js`

### Upload de arquivo falha
- Tamanho máximo: 10MB
- Formatos aceitos: CSV, XLSX, XLS
- Verifique formato do CSV (headers NAME, PHONE obrigatórios)

### Estatísticas mostram "-"
- Crie ao menos uma campanha primeiro
- Verifique se há dados na campanha

## 🎓 Aprendizado

### Tailwind CSS via CDN
O painel usa Tailwind CSS direto do CDN:
```html
<script src="https://cdn.tailwindcss.com"></script>
```

### Classes principais usadas:
- `bg-*`: Cores de fundo
- `text-*`: Cores de texto
- `rounded-*`: Bordas arredondadas
- `shadow-*`: Sombras
- `grid`, `flex`: Layouts
- `hover:*`: Estados hover
- `transition-*`: Transições animadas

### SPA com Vanilla JS
Navegação sem reload:
```javascript
App.navigateTo('campaigns');  // Muda de página sem reload
```

## 🚀 Próximos Passos

- [ ] Adicionar gráficos (Chart.js)
- [ ] Exportar relatórios (PDF, Excel)
- [ ] Filtros avançados por data
- [ ] Busca full-text nas campanhas
- [ ] Notificações em tempo real (WebSocket)
- [ ] Temas claro/escuro
- [ ] Modo offline (Service Worker)

## 📞 Suporte

Para dúvidas ou problemas:
1. Verifique este README
2. Consulte a documentação da API
3. Verifique o console do navegador (F12)

---

**BeeLabs © 2025** - Sistema de Broadcast WhatsApp
