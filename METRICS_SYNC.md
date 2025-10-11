# 📊 Sincronização Dinâmica de Métricas

Este documento descreve as estratégias implementadas para sincronização de métricas de campanhas sem uso de cron jobs.

## 🎯 Abordagens Implementadas

### 1. **Event-Driven (Push) - Webhooks em Tempo Real**

Webhooks são enviados automaticamente quando há mudanças significativas nas campanhas.

#### Eventos de Webhook

1. **Criação de Campanha**
   - Trigger: Quando `createCampaign()` é chamado
   - Payload: Status inicial (DRAFT)

2. **Importação de Contatos Concluída**
   - Trigger: Quando o último lote de contatos é importado
   - Payload: Total de contatos importados
   - Local: `import-contacts.processor.ts`

3. **Progresso de Envio (Throttled)**
   - Trigger: A cada 10 mensagens OU a cada 30 segundos
   - Payload: Métricas atualizadas (enviados, falhas, progresso)
   - Local: `broadcast.processor.ts`
   - **Throttling**: Evita sobrecarga de webhooks

4. **Campanha Completada**
   - Trigger: Quando todos os destinatários são processados
   - Payload: Métricas finais completas
   - Local: `broadcast.processor.ts`

5. **Mudanças de Status**
   - Trigger: Start, Pause, Resume, Cancel
   - Payload: Novo status da campanha

#### Configuração de Throttling

```typescript
// Em broadcast.processor.ts
private readonly PROGRESS_THRESHOLD = 10;    // Mensagens
private readonly PROGRESS_INTERVAL = 30000;  // 30 segundos
```

#### Endpoints de Webhook

```http
POST {baseUrl}/api/v1/webhooks/campaign-webhook
```

**Payloads:**

**1. Update Status (Mudanças de Status)**
```json
{
  "event": "update_status",
  "broadcastId": "campaign-id",
  "status": 5
}
```

**2. Broadcast Summary (Métricas Completas)**
```json
{
  "event": "broadcast:statusUpdate",
  "data": {
    "broadcastId": "campaign-id",
    "details": {
      "status": 5,
      "totalContacts": 150,
      "sentContacts": 120,
      "deliveredContacts": 115,
      "readContacts": 95,
      "failedContacts": 5,
      "pendingContacts": 25
    }
  }
}
```

**Descrição dos Campos:**
- `totalContacts`: Total de contatos na campanha
- `sentContacts`: Quantidade de mensagens enviadas com sucesso
- `deliveredContacts`: Quantidade de mensagens entregues (confirmadas pelo WhatsApp)
- `readContacts`: Quantidade de mensagens lidas pelo destinatário
- `failedContacts`: Quantidade de mensagens que falharam no envio
- `pendingContacts`: Quantidade de mensagens ainda não processadas (totalContacts - sentContacts - failedContacts)

---

### 2. **On-Demand (Pull) - API de Métricas**

O serviço externo pode consultar métricas quando necessário.

#### Endpoints Disponíveis

##### 1. Métricas de Campanha Específica
```http
GET /api/metrics/campaign/:id
```

**Resposta:**
```json
{
  "campaignId": "abc-123",
  "name": "Campanha de Boas-vindas",
  "status": "PROCESSING",
  "totalRecipients": 150,
  "sentCount": 100,
  "deliveredCount": 95,
  "readCount": 80,
  "failedCount": 5,
  "pendingCount": 45,
  "progress": 70.0,
  "rates": {
    "success": 66.67,
    "delivery": 95.0,
    "read": 84.21,
    "failure": 3.33
  },
  "timestamps": {
    "createdAt": "2025-10-09T19:00:00Z",
    "startedAt": "2025-10-09T19:05:00Z",
    "completedAt": null
  }
}
```

##### 2. Métricas de Múltiplas Campanhas
```http
GET /api/metrics/campaigns?ids=id1,id2,id3
```

##### 3. Campanhas Ativas
```http
GET /api/metrics/active
```

Retorna métricas de todas as campanhas com status `PROCESSING` ou `SCHEDULED`.

##### 4. Métricas por Canal
```http
GET /api/metrics/channel/:channel
```

**Resposta:**
```json
{
  "channel": "4-teste1.bee.local",
  "totalCampaigns": 25,
  "activeCampaigns": 3,
  "totalMessages": 5000,
  "sentMessages": 4500,
  "failedMessages": 250,
  "successRate": 90.0
}
```

##### 5. Overview Geral
```http
GET /api/metrics/overview
```

**Resposta:**
```json
{
  "total": 50,
  "byStatus": {
    "DRAFT": 5,
    "PROCESSING": 3,
    "COMPLETED": 40,
    "FAILED": 2
  },
  "totalMessages": 10000,
  "sentMessages": 9500,
  "failedMessages": 300,
  "deliveredMessages": 9000,
  "readMessages": 7500,
  "successRate": 95.0,
  "deliveryRate": 94.74,
  "readRate": 83.33
}
```

---

### 3. **WebSocket (Tempo Real) - Futuro**

Para implementar no futuro, caso necessário:

```typescript
// Exemplo de implementação com Socket.io
@WebSocketGateway()
export class MetricsGateway {
  @WebSocketServer()
  server: Server;

  emitCampaignUpdate(campaignId: string, metrics: any) {
    this.server.emit(`campaign:${campaignId}`, metrics);
  }
}
```

---

## 🚀 Estratégias Recomendadas por Caso de Uso

### Caso 1: Dashboard em Tempo Real
**Abordagem:** WebSocket ou Polling curto (5-10s) + Webhooks
- Use polling na API `/api/metrics/active` a cada 10 segundos
- Receba webhooks para mudanças importantes
- Melhor UX com atualizações instantâneas

### Caso 2: Relatórios e Analytics
**Abordagem:** Pull API on-demand
- Consulte `/api/metrics/overview` quando o usuário acessar
- Use `/api/metrics/campaign/:id` para detalhes
- Não sobrecarrega o sistema

### Caso 3: Integrações Externas
**Abordagem:** Webhooks + API de fallback
- Configure webhooks para eventos importantes
- Use API de métricas para sincronização inicial
- Resiliente a falhas de webhook

### Caso 4: Monitoramento de SLA
**Abordagem:** Polling médio (30-60s)
- Consulte `/api/metrics/active` periodicamente
- Alerte quando métricas saem do esperado
- Baixo overhead, alta confiabilidade

---

## 🔧 Configuração

### Variáveis de Ambiente

```env
# URL base do serviço externo
CAMPAIGN_WEBHOOK_TOKEN=seu-token-aqui

# Para ambientes locais com bee.local
# Webhooks serão enviados para http://localhost:9000
```

### Configuração de Domínios Locais

O sistema detecta automaticamente domínios `bee.local` e redireciona para `localhost:9000`:

```typescript
// Em campaign-webhook.service.ts
if (domain.includes('bee.local')) {
  return 'http://localhost:9000';
}
```

---

## 📈 Performance e Escalabilidade

### Throttling de Webhooks
- **Evita spam**: Máximo 1 webhook a cada 30s ou 10 mensagens
- **Cache em memória**: Usa `Map` para rastrear último envio
- **Limpeza automática**: Cache é limpo quando campanha completa

### Otimizações de Query
- Usa `select` para buscar apenas campos necessários
- Índices no banco: `campaignId`, `status`, `deletedAt`
- Agregações feitas em memória para pequenos datasets

### Limites Recomendados
- **Webhooks**: Até 1 req/s por campanha
- **API Polling**: Máximo 1 req/10s
- **Batch queries**: Até 50 campanhas por vez

---

## 🧪 Testando

### Testar Webhooks
```bash
# Inicie o servidor externo em localhost:9000
# Crie uma campanha com canal bee.local
curl -X POST http://localhost:3000/api/broadcast/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Teste",
    "channel": "4-teste1.bee.local",
    "template": {...}
  }'
```

### Testar API de Métricas
```bash
# Obter métricas de campanha
curl http://localhost:3000/api/metrics/campaign/{campaignId}

# Obter campanhas ativas
curl http://localhost:3000/api/metrics/active

# Overview geral
curl http://localhost:3000/api/metrics/overview
```

---

## 🎯 Comparação de Abordagens

| Característica | Webhooks (Push) | API (Pull) | WebSocket | Cron |
|---------------|-----------------|-----------|-----------|------|
| **Latência** | Baixa (~1s) | Média (polling interval) | Muito baixa (~100ms) | Alta (minutos) |
| **Overhead** | Baixo | Médio | Alto | Baixo |
| **Confiabilidade** | Média (pode falhar) | Alta | Média | Alta |
| **Complexidade** | Baixa | Muito baixa | Alta | Baixa |
| **Escalabilidade** | Alta | Média | Baixa | Alta |
| **Recomendado para** | Eventos importantes | Consultas sob demanda | Dashboards real-time | Tarefas batch |

---

## 📝 Próximos Passos

1. [ ] Implementar retry de webhooks com fila DLQ
2. [ ] Adicionar autenticação nos endpoints de métricas
3. [ ] Criar dashboard web consumindo a API de métricas
4. [ ] Implementar WebSocket para atualizações real-time
5. [ ] Adicionar métricas de performance (latência, throughput)
6. [ ] Sistema de alertas baseado em métricas

---

## 💡 Dicas de Implementação no Serviço Externo

### Node.js/Express
```javascript
// Receber webhooks
app.post('/api/v1/webhooks/campaign-webhook', (req, res) => {
  const { event, broadcastId, status, data } = req.body;
  
  // Processar evento
  if (event === 'update_status') {
    updateCampaignStatus(broadcastId, status);
  } else if (event === 'broadcast:statusUpdate') {
    updateCampaignMetrics(data.broadcastId, data.details);
  }
  
  res.status(200).json({ received: true });
});

// Polling de métricas
setInterval(async () => {
  const metrics = await fetch('http://localhost:3000/api/metrics/active');
  const data = await metrics.json();
  
  data.forEach(campaign => {
    updateDashboard(campaign);
  });
}, 10000); // A cada 10 segundos
```

### React/Next.js
```typescript
// Hook customizado para métricas
function useCampaignMetrics(campaignId: string) {
  const [metrics, setMetrics] = useState(null);
  
  useEffect(() => {
    const fetchMetrics = async () => {
      const response = await fetch(`/api/metrics/campaign/${campaignId}`);
      const data = await response.json();
      setMetrics(data);
    };
    
    // Fetch inicial
    fetchMetrics();
    
    // Polling a cada 5 segundos
    const interval = setInterval(fetchMetrics, 5000);
    
    return () => clearInterval(interval);
  }, [campaignId]);
  
  return metrics;
}
```

---

**Autor:** BeeLabs Team  
**Última atualização:** 10 de outubro de 2025
