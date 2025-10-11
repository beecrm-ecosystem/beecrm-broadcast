# Módulo Broadcast - Campanhas de Marketing WhatsApp

## 📁 Estrutura do Módulo

```
src/broadcast/
├── schemas/
│   └── broadcast.dto.ts          # DTOs e validações
├── broadcast.module.ts            # Módulo NestJS
├── broadcast.controller.ts        # Controlador REST API
├── broadcast.service.ts           # Lógica de negócio
├── broadcast.interceptor.ts       # Interceptor para logs
├── prisma.service.ts              # Service do Prisma Client
└── README.md                      # Esta documentação
```

## 🏗️ Arquitetura

Este módulo segue os princípios **CLEAN Architecture** e **SOLID**:

- **Single Responsibility**: Cada arquivo tem uma responsabilidade única
- **Open/Closed**: Extensível sem modificar o código existente
- **Liskov Substitution**: Services podem ser substituídos por implementações alternativas
- **Interface Segregation**: DTOs específicos para cada operação
- **Dependency Inversion**: Controller depende de abstrações (Service)

### Camadas

1. **Presentation Layer** (`broadcast.controller.ts`)
   - Recebe requisições HTTP
   - Valida dados de entrada via DTOs
   - Retorna respostas formatadas

2. **Business Layer** (`broadcast.service.ts`)
   - Contém toda a lógica de negócio
   - Valida regras de negócio
   - Orquestra operações com o banco de dados

3. **Data Layer** (`prisma.service.ts`)
   - Gerencia conexão com o banco de dados
   - Expõe o Prisma Client

4. **DTOs** (`schemas/broadcast.dto.ts`)
   - Define contratos de entrada/saída
   - Validações com class-validator

## 🚀 Como Usar

### 1. Configurar o Banco de Dados

Primeiro, configure a variável de ambiente `DATABASE_URL` no `.env`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/beecrm_broadcast?schema=public"
```

### 2. Gerar o Prisma Client

Execute a migração para criar as tabelas:

```bash
npm run prisma:migrate:dev
```

### 3. Iniciar o Servidor

```bash
npm run start:dev
```

## 📡 API Endpoints

### **Campanhas**

#### `POST /broadcast`
Cria uma nova campanha

**Body:**
```json
{
  "name": "Black Friday 2025",
  "description": "Campanha de ofertas especiais",
  "templateId": "uuid-do-template",
  "channel": "whatsapp",
  "phoneNumberId": "123456789",
  "scheduledAt": "2025-11-29T00:00:00Z",
  "batchSize": 100,
  "delayBetweenBatches": 5000,
  "tags": ["black-friday", "promocao"],
  "metadata": {
    "discount": 50
  }
}
```

#### `GET /broadcast`
Lista todas as campanhas

**Query Params:**
- `status`: DRAFT | SCHEDULED | PROCESSING | COMPLETED | PAUSED | CANCELED | FAILED
- `tags`: array de strings
- `page`: número da página (padrão: 1)
- `limit`: itens por página (padrão: 10, max: 100)

**Exemplo:**
```
GET /broadcast?status=PROCESSING&page=1&limit=20
```

#### `GET /broadcast/:id`
Busca uma campanha específica

#### `PUT /broadcast/:id`
Atualiza uma campanha

**Body:**
```json
{
  "name": "Novo Nome",
  "description": "Nova descrição",
  "scheduledAt": "2025-12-01T00:00:00Z",
  "tags": ["nova-tag"]
}
```

#### `DELETE /broadcast/:id`
Remove uma campanha (soft delete)

---

### **Destinatários**

#### `POST /broadcast/:id/recipients`
Adiciona destinatários a uma campanha

**Body:**
```json
{
  "recipients": [
    {
      "phoneNumber": "5511999999999",
      "name": "João Silva",
      "email": "joao@example.com",
      "variables": {
        "1": "João Silva",
        "2": "Produto Premium",
        "3": "199.90"
      },
      "metadata": {
        "segment": "premium"
      }
    },
    {
      "phoneNumber": "5511988888888",
      "name": "Maria Santos",
      "variables": {
        "1": "Maria Santos",
        "2": "Produto Básico",
        "3": "99.90"
      }
    }
  ]
}
```

#### `GET /broadcast/:id/recipients`
Lista os destinatários de uma campanha

**Query Params:**
- `page`: número da página (padrão: 1)
- `limit`: itens por página (padrão: 50)

---

### **Controle de Campanha**

#### `POST /broadcast/:id/start`
Inicia uma campanha

**Requisitos:**
- Status deve ser DRAFT ou SCHEDULED
- Deve ter pelo menos 1 destinatário

#### `POST /broadcast/:id/pause`
Pausa uma campanha em execução

**Requisitos:**
- Status deve ser PROCESSING

#### `POST /broadcast/:id/resume`
Retoma uma campanha pausada

**Requisitos:**
- Status deve ser PAUSED

#### `POST /broadcast/:id/cancel`
Cancela uma campanha

**Requisitos:**
- Status não pode ser COMPLETED ou CANCELED

---

### **Estatísticas**

#### `GET /broadcast/:id/stats`
Obtém estatísticas detalhadas de uma campanha

**Resposta:**
```json
{
  "campaign": {
    "id": "uuid",
    "name": "Black Friday 2025",
    "status": "COMPLETED",
    "startedAt": "2025-11-29T00:00:00Z",
    "completedAt": "2025-11-29T23:59:59Z"
  },
  "stats": {
    "totalRecipients": 1000,
    "sent": 950,
    "delivered": 920,
    "read": 800,
    "failed": 50,
    "pending": 0
  },
  "rates": {
    "delivery": "96.84%",
    "read": "86.96%",
    "failure": "5.26%"
  }
}
```

## 🔧 Regras de Negócio

### Estados da Campanha

```
DRAFT → SCHEDULED → PROCESSING → COMPLETED
                         ↓
                      PAUSED → PROCESSING
                         ↓
                      CANCELED
```

### Validações

1. **Criação de Campanha**
   - `name`: obrigatório
   - `templateId`: deve existir no banco
   - `batchSize`: entre 1 e 1000
   - `delayBetweenBatches`: mínimo 1000ms

2. **Edição de Campanha**
   - Não é possível editar campanhas COMPLETED ou CANCELED
   - Apenas campos específicos podem ser editados

3. **Início de Campanha**
   - Deve ter pelo menos 1 destinatário
   - Status deve ser DRAFT ou SCHEDULED

4. **Destinatários**
   - `phoneNumber`: obrigatório (formato internacional)
   - Não permite duplicatas na mesma campanha

## 📊 Exemplo de Uso Completo

```typescript
// 1. Criar campanha
const campaign = await fetch('http://localhost:3000/broadcast', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Campanha Teste',
    templateId: 'template-uuid',
    channel: 'whatsapp'
  })
});

// 2. Adicionar destinatários
await fetch(`http://localhost:3000/broadcast/${campaign.id}/recipients`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    recipients: [
      {
        phoneNumber: '5511999999999',
        name: 'João Silva',
        variables: { '1': 'João', '2': 'Premium' }
      }
    ]
  })
});

// 3. Iniciar campanha
await fetch(`http://localhost:3000/broadcast/${campaign.id}/start`, {
  method: 'POST'
});

// 4. Acompanhar estatísticas
const stats = await fetch(`http://localhost:3000/broadcast/${campaign.id}/stats`);
console.log(await stats.json());
```

## 🧪 Testes

Para testar os endpoints, você pode usar:

- **Postman**: Importe a collection (criar arquivo separado)
- **cURL**: Exemplos abaixo
- **REST Client** (VS Code extension)

### Exemplo com cURL

```bash
# Criar campanha
curl -X POST http://localhost:3000/broadcast \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Teste",
    "templateId": "uuid",
    "channel": "whatsapp"
  }'

# Listar campanhas
curl http://localhost:3000/broadcast?status=DRAFT&page=1&limit=10

# Ver estatísticas
curl http://localhost:3000/broadcast/{id}/stats
```

## 🔜 Próximos Passos

1. **Integração com WhatsApp Graph API**
   - Criar módulo de integração
   - Implementar envio de mensagens
   - Processar webhooks

2. **Processamento em Fila (BullMQ)**
   - Criar job para processar lotes
   - Implementar retry logic
   - Adicionar rate limiting

3. **Templates**
   - Criar CRUD de templates
   - Integrar com WhatsApp API
   - Validar variáveis

4. **Autenticação e Autorização**
   - Implementar Guards
   - Adicionar permissões por role
   - Audit log de ações

5. **Testes**
   - Testes unitários (Jest)
   - Testes de integração
   - Testes E2E

## 📝 Notas

- Todas as datas são em formato ISO 8601
- Números de telefone devem estar no formato internacional (sem + ou 00)
- Soft delete é usado para manter histórico
- Estatísticas são desnormalizadas para performance
