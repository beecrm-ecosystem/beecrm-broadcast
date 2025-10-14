# Sistema de Logs de Webhooks

Este diretório contém os logs detalhados de todos os webhooks recebidos pelo sistema.

## 📁 Estrutura de Arquivos

Os logs são salvos em arquivos diários com o formato:
```
webhooks-YYYY-MM-DD.log
```

Exemplo: `webhooks-2025-10-14.log`

## 📝 Formato dos Logs

Cada linha do arquivo é um objeto JSON com o seguinte formato:

```json
{
  "timestamp": "2025-10-14T16:13:01.234Z",
  "type": "meta",
  "messageId": "wamid.HBgNNTUxMTk5OTA2MTgwMRUCABEYEjQxNUYyMzZCODI5MDExN0E2QQA=",
  "status": "read",
  "recipient": "5511999061801",
  "metadata": {
    "display_phone_number": "556533261481",
    "phone_number_id": "358483814022925"
  },
  "payload": {
    "id": "wamid.xxx",
    "status": "read",
    "timestamp": "1760458380",
    "recipient_id": "5511999061801"
  }
}
```

## 🔍 Como Consultar os Logs

### Via Linha de Comando

Buscar por um número de telefone específico:
```bash
grep "5511999061801" logs/webhooks/webhooks-2025-10-14.log
```

Contar quantos webhooks de um status específico:
```bash
grep '"status":"delivered"' logs/webhooks/webhooks-2025-10-14.log | wc -l
```

Ver os últimos 10 webhooks:
```bash
tail -n 10 logs/webhooks/webhooks-2025-10-14.log
```

### Via API

Obter estatísticas dos logs:
```bash
GET /api/logs/stats
```

Limpar logs com mais de 30 dias:
```bash
DELETE /api/logs/cleanup?days=30
```

## 🗑️ Limpeza Automática

Os logs antigos podem ser limpos automaticamente. Por padrão, logs com mais de 30 dias são mantidos.

Para limpar manualmente:
```bash
curl -X DELETE http://localhost:4000/api/logs/cleanup?days=30
```

## 📊 Vantagens deste Sistema

1. **Redução de Logs no Terminal**: Apenas logs importantes aparecem no terminal (erros e avisos)
2. **Auditoria Completa**: Todos os webhooks são registrados em arquivo para análise posterior
3. **Performance**: Logging assíncrono não bloqueia o processamento
4. **Análise de Dados**: Formato JSON permite fácil análise com ferramentas como `jq`

## 🔧 Exemplos de Análise

### Usando `jq` para análise avançada

Contar webhooks por status:
```bash
cat webhooks-2025-10-14.log | jq -r '.status' | sort | uniq -c
```

Listar todos os recipients únicos:
```bash
cat webhooks-2025-10-14.log | jq -r '.recipient' | sort -u
```

Filtrar apenas webhooks com falha:
```bash
cat webhooks-2025-10-14.log | jq 'select(.status == "failed")'
```

Ver webhooks entre horários específicos:
```bash
cat webhooks-2025-10-14.log | jq 'select(.timestamp >= "2025-10-14T14:00:00Z" and .timestamp <= "2025-10-14T15:00:00Z")'
```

## 📈 Monitoramento

Para monitorar em tempo real:
```bash
tail -f logs/webhooks/webhooks-$(date +%Y-%m-%d).log
```

Para monitorar apenas um status específico:
```bash
tail -f logs/webhooks/webhooks-$(date +%Y-%m-%d).log | grep '"status":"delivered"'
```

## ⚠️ Importante

- Esta pasta está no `.gitignore` e não será commitada
- Logs são salvos localmente em cada servidor
- Configure backups se precisar manter histórico longo
- Considere usar ferramentas de log aggregation (ELK, Splunk, etc) para ambientes de produção
