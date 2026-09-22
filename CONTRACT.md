# Contrato de integração com o BeeCRM

Este microserviço expõe uma API REST consumida pelo monólito **BeeCRM** e envia
**webhooks de status** de volta para ele. Para parar o *drift* entre os dois
repositórios (Fase 0 do saneamento de contrato):

## Lado máquina — OpenAPI (REST)

Gere o contrato REST versionado:

```bash
npm run export:openapi   # gera ./openapi.json
```

> Requer envs de Redis (o `AppModule` inicializa o BullMQ no boot).

Commite o `openapi.json`. Em PRs, o diff desse arquivo sinaliza **breaking changes**
no contrato consumido pelo CRM.

## Lado humano — documento canônico

A descrição completa do contrato (endpoints REST consumidos + os 3 eventos de
webhook enviados ao CRM + esquema de assinatura HMAC) vive no repo do CRM:

- `beecrm/docs/integrations/broadcast-contract.md`

E o cliente único do lado CRM (fonte de verdade das chamadas de saída):

- `beecrm/app/Services/CampaingServices/BroadcastClient.php`
- testes de contrato: `beecrm/tests/Unit/Services/BroadcastClientTest.php`

## Regra

Qualquer mudança de endpoint / payload / evento de webhook deve atualizar, no mesmo PR:
1. o código (controllers/DTOs aqui; `BroadcastClient` no CRM),
2. o `openapi.json` (rodar `export:openapi`),
3. o documento canônico no CRM,
4. os testes de contrato no CRM.

## Webhooks que ESTE serviço envia ao CRM

`POST {CRM}/api/v1/webhooks/campaign-webhook`, assinado com HMAC-SHA256:

```
X-Bee-Timestamp: <unix segundos>
X-Bee-Signature: hash_hmac('sha256', "<timestamp>.<raw_body>", CAMPAIGN_WEBHOOK_SECRET)
```

Janela de tolerância: ±300s. Eventos: `broadcast:statusUpdate`, `broadcast:messageResults`,
`update_status` (legado). Detalhe dos payloads no documento canônico do CRM.

### Destino do webhook (`{CRM}`)

1. **`metadata.webhookUrl`** do create da campanha: URL completa gerada pelo CRM
   (`Util::campaignWebhookUrl()`), no formato
   `https://api.beecrm.io/api/v1/t/{tenant}/webhooks/campaign-webhook`. Só vale
   com HTTPS e host listado em `CRM_WEBHOOK_ALLOWED_HOSTS`; sem a lista, é recusada.
2. **Legado:** sem `webhookUrl` (ou com ela recusada), a base sai do campo `channel`
   (`<canal>-<domínio do tenant>`) + `/api/v1/webhooks/campaign-webhook`. Na URL
   única o domínio do tenant não existe no DNS, e campanhas RCS (`channel: "rcs"`)
   não têm domínio: nesses casos só a opção 1 entrega.
