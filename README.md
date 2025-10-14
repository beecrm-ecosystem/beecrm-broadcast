# BeeCRM Broadcast 🐝

Sistema de envio de campanhas de broadcast via WhatsApp Business API usando NestJS, Prisma e BullMQ.

## 📋 Descrição

O **BeeCRM Broadcast** é uma aplicação robusta para gerenciamento e envio de campanhas de marketing em massa via WhatsApp. Desenvolvido com NestJS e seguindo princípios de Clean Architecture, oferece controle completo sobre o envio de mensagens, rastreamento de status e análise de métricas.

### Funcionalidades Principais

- ✅ **Gerenciamento de Campanhas**: Criação, agendamento e controle de campanhas de broadcast
- ✅ **Templates do WhatsApp**: Suporte completo para templates aprovados pela Meta
- ✅ **Envio em Lotes**: Controle de rate limiting com envio em lotes configuráveis
- ✅ **Rastreamento de Status**: Acompanhamento em tempo real do status das mensagens (enviado, entregue, lido)
- ✅ **Webhooks do Meta**: Recepção e processamento de eventos de status do WhatsApp
- ✅ **Filas com BullMQ**: Processamento assíncrono e resiliente
- ✅ **Importação em Massa**: Upload de contatos via CSV/Excel
- ✅ **Métricas Detalhadas**: Estatísticas completas de desempenho das campanhas
- ✅ **Integração com Diogenes**: Envio via plataforma Diogenes WhatsApp

## 🏗️ Arquitetura

```
├── src/
│   ├── broadcast/              # Módulo principal de broadcast
│   │   ├── controllers/        # Controladores REST
│   │   ├── services/          # Lógica de negócio
│   │   ├── queues/            # Processadores de fila (BullMQ)
│   │   ├── webhook/           # Recepção de webhooks do Meta
│   │   ├── schemas/           # DTOs e validações
│   │   └── metrics/           # Endpoints de métricas
│   ├── prisma/                # Configuração do Prisma ORM
│   └── main.ts                # Ponto de entrada da aplicação
└── prisma/
    ├── schema.prisma          # Schema do banco de dados
    └── migrations/            # Migrações do banco
```

## 🔧 Tecnologias

- **NestJS** - Framework Node.js progressivo
- **Prisma** - ORM moderno para PostgreSQL
- **BullMQ** - Filas de processamento baseadas em Redis
- **PostgreSQL** - Banco de dados relacional
- **Redis** - Cache e gerenciamento de filas
- **TypeScript** - Tipagem estática
- **Docker** - Containerização

## 📦 Instalação

### Pré-requisitos

- Node.js >= 18.x
- PostgreSQL >= 14.x
- Redis >= 6.x
- Yarn ou NPM

### 1. Clonar o repositório

```bash
git clone <repository-url>
cd beecrm-broadcast
```

### 2. Instalar dependências

```bash
yarn install
```

### 3. Configurar variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/beecrm_broadcast?schema=public"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Application
PORT=3000
NODE_ENV=development

# Diogenes API
DIOGENES_API_URL=https://api.diogenes.com
DIOGENES_API_KEY=your-api-key-here

# WhatsApp Business
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WHATSAPP_BUSINESS_ACCOUNT_ID=your-business-account-id

# Webhook Configuration
WEBHOOK_BASE_URL=https://your-domain.com
```

### 4. Configurar o banco de dados

```bash
# Executar migrações
npx prisma migrate deploy

# (Opcional) Seed de dados iniciais
yarn prisma:seed
```

### 5. Iniciar a aplicação

```bash
# Modo desenvolvimento
yarn start:dev

# Modo produção
yarn build
yarn start:prod
```

A aplicação estará disponível em `http://localhost:3000`

## 🔗 Webhook do Meta (WhatsApp)

Para receber atualizações de status das mensagens enviadas pelo WhatsApp (entregue, lido, falha), você precisa configurar o webhook no Meta for Developers.

### URL do Webhook

Configure a seguinte URL no painel do Meta for Developers ou Diogenes:

```
POST https://your-domain.com/webhook/diogenes
```

### Estrutura do Payload Recebido

O webhook receberá eventos no seguinte formato:

```json
{
  "event": "messages.update",
  "instance": "instance-name",
  "data": {
    "key": {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "fromMe": true,
      "id": "3EB0C7XXXXXX"
    },
    "status": "delivered",
    "messageTimestamp": 1697234567,
    "pushName": "User Name"
  },
  "destination": "5511999999999",
  "date_time": "2023-10-13T12:34:56.789Z",
  "server_url": "https://api.diogenes.com",
  "apikey": "your-api-key"
}
```

### Eventos Suportados

| Evento | Status | Descrição |
|--------|--------|-----------|
| `messages.upsert` | `sent` | Mensagem enviada |
| `messages.update` | `delivered` | Mensagem entregue ao destinatário |
| `messages.update` | `read` | Mensagem lida pelo destinatário |
| `messages.update` | `failed` | Falha no envio |

### Configuração no Meta for Developers

1. Acesse o [Meta for Developers](https://developers.facebook.com/)
2. Selecione seu aplicativo WhatsApp Business
3. Vá em **WhatsApp > Configuration**
4. Na seção **Webhooks**, clique em **Edit**
5. Cole a URL do webhook: `https://your-domain.com/webhook/diogenes`
6. Inscreva-se nos eventos: `messages`, `message_status`
7. Salve as configurações

### Testando o Webhook

Para testar o webhook localmente, você pode usar o endpoint de teste:

```bash
curl -X POST http://localhost:3000/webhook/diogenes/test \
  -H "Content-Type: application/json" \
  -d '{
    "event": "messages.update",
    "data": {
      "key": {
        "id": "test-message-id"
      },
      "status": "delivered"
    }
  }'
```

### Segurança do Webhook

- ✅ Valide sempre o token de verificação fornecido pelo Meta
- ✅ Use HTTPS em produção
- ✅ Implemente rate limiting
- ✅ Registre todos os eventos recebidos para auditoria

## 📡 API Endpoints

### Campanhas

#### Criar Campanha
```http
POST /broadcast
Content-Type: application/json

{
  "name": "Black Friday 2025",
  "description": "Campanha de ofertas especiais",
  "templateId": "uuid-do-template",
  "channel": "whatsapp",
  "phoneNumberId": "123456789",
  "scheduledAt": "2025-11-29T00:00:00Z",
  "batchSize": 100,
  "delayBetweenBatches": 5000,
  "tags": ["black-friday", "promocao"]
}
```

#### Listar Campanhas
```http
GET /broadcast?status=PROCESSING&page=1&limit=20
```

#### Obter Campanha por ID
```http
GET /broadcast/:id
```

#### Atualizar Campanha
```http
PUT /broadcast/:id
```

#### Deletar Campanha
```http
DELETE /broadcast/:id
```

### Destinatários

#### Adicionar Destinatários
```http
POST /broadcast/:id/recipients
```

#### Listar Destinatários
```http
GET /broadcast/:id/recipients?page=1&limit=50
```

### Controle de Campanha

#### Iniciar Campanha
```http
POST /broadcast/:id/start
```

#### Pausar Campanha
```http
POST /broadcast/:id/pause
```

#### Retomar Campanha
```http
POST /broadcast/:id/resume
```

#### Cancelar Campanha
```http
POST /broadcast/:id/cancel
```

### Métricas

#### Obter Estatísticas da Campanha
```http
GET /broadcast/:id/stats
```

## 🗄️ Modelo de Dados

### Campaign (Campanha)
- **Status**: DRAFT | SCHEDULED | PROCESSING | COMPLETED | PAUSED | CANCELED | FAILED
- **Envio em lotes**: Configurável via `batchSize` e `delayBetweenBatches`
- **Rastreamento**: Contadores de mensagens enviadas, entregues, lidas e falhas

### CampaignRecipient (Destinatário)
- **Status**: PENDING | QUEUED | SENT | DELIVERED | READ | FAILED
- **Variáveis**: Suporte a variáveis dinâmicas para templates do WhatsApp
- **Metadados**: Campos customizados para segmentação

### Message (Mensagem)
- **IDs externos**: WhatsApp Message ID e WABA ID
- **Timestamps**: Rastreamento completo (enviado, entregue, lido)
- **Retentativas**: Sistema de retry configurável

### WebhookEvent (Evento de Webhook)
- **Payload completo**: Armazena todo o JSON recebido
- **Processamento**: Flag de controle de eventos processados
- **Auditoria**: Histórico completo de todos os webhooks recebidos

## 🚀 Deployment

### Docker

```bash
# Build da imagem
docker build -t beecrm-broadcast .

# Executar com docker-compose
docker-compose up -d
```

### Variáveis de Ambiente de Produção

```env
NODE_ENV=production
DATABASE_URL=postgresql://user:password@postgres:5432/beecrm
REDIS_HOST=redis
REDIS_PORT=6379
WEBHOOK_BASE_URL=https://api.yourdomain.com
```

## 🧪 Testes

```bash
# Testes unitários
yarn test

# Testes e2e
yarn test:e2e

# Cobertura de testes
yarn test:cov
```

## 📝 Scripts Disponíveis

```bash
# Desenvolvimento
yarn start:dev          # Inicia em modo watch
yarn start:debug        # Inicia com debugger

# Build
yarn build              # Compila o projeto

# Produção
yarn start:prod         # Executa versão compilada

# Database
npx prisma migrate dev  # Cria nova migração
npx prisma migrate deploy # Aplica migrações
npx prisma studio       # Abre interface visual do DB
yarn prisma:seed        # Executa seed de dados

# Code Quality
yarn lint               # Executa ESLint
yarn format             # Formata código com Prettier
```

## 🔐 Segurança

- ✅ Use sempre HTTPS em produção
- ✅ Mantenha as chaves de API em variáveis de ambiente
- ✅ Implemente rate limiting nos endpoints
- ✅ Valide todos os inputs com class-validator
- ✅ Registre logs de auditoria para ações críticas

## 📚 Documentação Adicional

- 🔗 **[Exemplos de Webhooks](./WEBHOOK_EXAMPLES.md)** - Guia completo com exemplos práticos de webhooks
- 🔄 **[Sistema de Filas para Webhooks](./WEBHOOK_QUEUE.md)** - Processamento assíncrono e resiliente de webhooks
- [Módulo Broadcast](./src/broadcast/README.md) - Documentação detalhada da API
- [Schema Prisma](./prisma/schema.prisma) - Modelo completo do banco de dados
- [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp) - Documentação oficial do Meta
- [NestJS Documentation](https://docs.nestjs.com) - Framework NestJS

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença UNLICENSED.

## ✨ Autores

**BeeLabs Team** - *Desenvolvimento do BeeCRM Broadcast*

## 🐛 Suporte

Para reportar bugs ou solicitar features, abra uma issue no repositório.

---

Desenvolvido com ❤️ pela equipe BeeLabs
