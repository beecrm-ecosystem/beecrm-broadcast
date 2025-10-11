# 📤 Exemplos de Payloads de Webhook

Este documento mostra exemplos reais dos payloads enviados pelo sistema de broadcast.

## Endpoint

```
POST {baseUrl}/api/v1/webhooks/campaign-webhook
Authorization: Bearer {token}
Content-Type: application/json
```

---

## 1. Update Status (Mudanças de Status)

Enviado quando o status da campanha muda (criação, início, pausa, resumo, cancelamento, conclusão).

### Exemplo: Campanha Criada

```json
{
  "event": "update_status",
  "broadcastId": "e41e5fff-edf4-43e9-b7b8-dcceec112d2f",
  "status": 0
}
```

### Exemplo: Campanha Iniciada

```json
{
  "event": "update_status",
  "broadcastId": "e41e5fff-edf4-43e9-b7b8-dcceec112d2f",
  "status": 5
}
```

### Exemplo: Campanha Completada

```json
{
  "event": "update_status",
  "broadcastId": "e41e5fff-edf4-43e9-b7b8-dcceec112d2f",
  "status": 1
}
```

### Mapeamento de Status

| Status | Código | Descrição |
|--------|--------|-----------|
| DRAFT | 0 | Rascunho |
| COMPLETED | 1 | Concluída |
| PAUSED | 3 | Pausada |
| CANCELED | 3 | Cancelada |
| SCHEDULED | 4 | Agendada |
| PROCESSING | 5 | Em processamento |
| FAILED | 6 | Falhou |

---

## 2. Broadcast Summary (Métricas Completas)

Enviado quando há atualizações nas métricas da campanha.

### Exemplo: Importação de Contatos Concluída

```json
{
  "event": "broadcast:statusUpdate",
  "data": {
    "broadcastId": "73163603-a6bf-40e3-8448-96f512119a4c",
    "details": {
      "status": 0,
      "totalContacts": 150,
      "sentContacts": 0,
      "deliveredContacts": 0,
      "readContacts": 0,
      "failedContacts": 0,
      "pendingContacts": 150
    }
  }
}
```

### Exemplo: Progresso de Envio (50% concluído)

```json
{
  "event": "broadcast:statusUpdate",
  "data": {
    "broadcastId": "73163603-a6bf-40e3-8448-96f512119a4c",
    "details": {
      "status": 5,
      "totalContacts": 150,
      "sentContacts": 70,
      "deliveredContacts": 68,
      "readContacts": 45,
      "failedContacts": 5,
      "pendingContacts": 75
    }
  }
}
```

### Exemplo: Campanha Completada

```json
{
  "event": "broadcast:statusUpdate",
  "data": {
    "broadcastId": "73163603-a6bf-40e3-8448-96f512119a4c",
    "details": {
      "status": 1,
      "totalContacts": 150,
      "sentContacts": 145,
      "deliveredContacts": 140,
      "readContacts": 120,
      "failedContacts": 5,
      "pendingContacts": 0
    }
  }
}
```

### Exemplo: Campanha com Erro

```json
{
  "event": "broadcast:statusUpdate",
  "data": {
    "broadcastId": "73163603-a6bf-40e3-8448-96f512119a4c",
    "details": {
      "status": 6,
      "totalContacts": 150,
      "sentContacts": 50,
      "deliveredContacts": 48,
      "readContacts": 30,
      "failedContacts": 100,
      "pendingContacts": 0,
      "error": "API de envio não está respondendo"
    }
  }
}
```

---

## Descrição dos Campos

### Event: `update_status`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `event` | string | Sempre "update_status" |
| `broadcastId` | string | ID único da campanha (ou externalId se definido em metadata) |
| `status` | number | Código do status da campanha (ver tabela acima) |
| `link` | string | (Opcional) Link relacionado à campanha |

### Event: `broadcast:statusUpdate`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `event` | string | Sempre "broadcast:statusUpdate" |
| `data.broadcastId` | string | ID único da campanha |
| `data.details.status` | number | Código do status da campanha |
| `data.details.totalContacts` | number | **Total de contatos na campanha** |
| `data.details.sentContacts` | number | **Quantidade enviada com sucesso** |
| `data.details.deliveredContacts` | number | **Quantidade entregue (confirmado pelo WhatsApp)** |
| `data.details.readContacts` | number | **Quantidade lida pelo destinatário** |
| `data.details.failedContacts` | number | **Quantidade que deu erro** |
| `data.details.pendingContacts` | number | **Quantidade que falta enviar** |
| `data.details.error` | string | (Opcional) Mensagem de erro se houver |
| `link` | string | (Opcional) Link relacionado à campanha |

---

## Quando os Webhooks São Enviados

### `update_status`

1. **Criação da Campanha**
   - Status: 0 (DRAFT)
   - Momento: Ao criar via POST /api/broadcast/campaigns

2. **Início da Campanha**
   - Status: 5 (PROCESSING)
   - Momento: Ao chamar POST /api/broadcast/campaigns/:id/start

3. **Pausa da Campanha**
   - Status: 3 (PAUSED)
   - Momento: Ao chamar POST /api/broadcast/campaigns/:id/pause

4. **Retomada da Campanha**
   - Status: 5 (PROCESSING)
   - Momento: Ao chamar POST /api/broadcast/campaigns/:id/resume

5. **Conclusão da Campanha**
   - Status: 1 (COMPLETED)
   - Momento: Quando todos os destinatários foram processados

6. **Cancelamento**
   - Status: 3 (CANCELED)
   - Momento: Ao chamar POST /api/broadcast/campaigns/:id/cancel

### `broadcast:statusUpdate`

1. **Importação de Contatos Concluída**
   - Momento: Quando o último lote de contatos é importado
   - Métricas: totalContacts atualizado, demais zerados

2. **Progresso de Envio (Throttled)**
   - Momento: A cada 10 mensagens OU a cada 30 segundos
   - Métricas: Valores atualizados em tempo real

3. **Campanha Completada**
   - Momento: Quando todos os destinatários foram processados
   - Métricas: Valores finais completos

4. **Adição Manual de Destinatários**
   - Momento: Ao chamar POST /api/broadcast/campaigns/:id/recipients
   - Métricas: totalContacts atualizado

---

## Exemplo de Implementação no Serviço Externo

### Node.js/Express

```javascript
app.post('/api/v1/webhooks/campaign-webhook', (req, res) => {
  const { event, broadcastId, status, data } = req.body;
  
  if (event === 'update_status') {
    // Atualiza apenas o status
    console.log(`Campanha ${broadcastId} mudou para status ${status}`);
    updateCampaignStatus(broadcastId, status);
    
  } else if (event === 'broadcast:statusUpdate') {
    // Atualiza todas as métricas
    const metrics = data.details;
    console.log(`Campanha ${data.broadcastId}:`);
    console.log(`  Total: ${metrics.totalContacts}`);
    console.log(`  Enviadas: ${metrics.sentContacts}`);
    console.log(`  Entregues: ${metrics.deliveredContacts}`);
    console.log(`  Lidas: ${metrics.readContacts}`);
    console.log(`  Falhas: ${metrics.failedContacts}`);
    console.log(`  Pendentes: ${metrics.pendingContacts}`);
    
    updateCampaignMetrics(data.broadcastId, metrics);
  }
  
  // IMPORTANTE: Sempre retorne 200 OK para não ficar recebendo o mesmo webhook
  res.status(200).json({ received: true });
});
```

### Laravel/PHP

```php
Route::post('/api/v1/webhooks/campaign-webhook', function (Request $request) {
    $event = $request->input('event');
    $broadcastId = $request->input('broadcastId') ?? $request->input('data.broadcastId');
    
    if ($event === 'update_status') {
        // Atualiza status
        $status = $request->input('status');
        Campaign::where('broadcast_id', $broadcastId)
            ->update(['status' => $status]);
            
    } elseif ($event === 'broadcast:statusUpdate') {
        // Atualiza métricas completas
        $details = $request->input('data.details');
        
        Campaign::where('broadcast_id', $broadcastId)->update([
            'total_contacts' => $details['totalContacts'],
            'sent_contacts' => $details['sentContacts'],
            'delivered_contacts' => $details['deliveredContacts'],
            'read_contacts' => $details['readContacts'],
            'failed_contacts' => $details['failedContacts'],
            'pending_contacts' => $details['pendingContacts'],
            'status' => $details['status'],
        ]);
    }
    
    return response()->json(['received' => true]);
});
```

### Python/Flask

```python
@app.route('/api/v1/webhooks/campaign-webhook', methods=['POST'])
def campaign_webhook():
    data = request.json
    event = data.get('event')
    
    if event == 'update_status':
        broadcast_id = data.get('broadcastId')
        status = data.get('status')
        update_campaign_status(broadcast_id, status)
        
    elif event == 'broadcast:statusUpdate':
        details = data.get('data', {}).get('details', {})
        broadcast_id = data.get('data', {}).get('broadcastId')
        
        update_campaign_metrics(
            broadcast_id=broadcast_id,
            total=details.get('totalContacts'),
            sent=details.get('sentContacts'),
            delivered=details.get('deliveredContacts'),
            read=details.get('readContacts'),
            failed=details.get('failedContacts'),
            pending=details.get('pendingContacts')
        )
    
    return jsonify({'received': True}), 200
```

---

## Testando Webhooks Localmente

### 1. Inicie um servidor de teste

```bash
# Node.js simples
npx http-server -p 9000

# Ou com Express
node test-webhook-server.js
```

### 2. Configure o canal com bee.local

```json
{
  "channel": "4-teste1.bee.local"
}
```

O sistema detectará automaticamente e enviará para `http://localhost:9000`

### 3. Monitore os logs

```bash
# No serviço de broadcast
[CampaignWebhookService] Webhook 'broadcast:statusUpdate' enviado para http://localhost:9000/api/v1/webhooks/campaign-webhook (broadcastId=xxx)
```

---

**Última atualização:** 10 de outubro de 2025
