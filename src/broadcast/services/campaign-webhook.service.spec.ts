import { of } from 'rxjs';
import { CampaignStatus } from '@prisma/client';
import { CampaignWebhookService } from './campaign-webhook.service';

const SINGLE_URL = 'https://api.beecrm.io/api/v1/t/5244b3f8-4027-4bb5-80b6-f2cce1cfe9f3/webhooks/campaign-webhook';

function makeService() {
  const http = { post: jest.fn().mockReturnValue(of({ status: 200, data: {} })) };
  // high-water-mark dos contadores (Lua no Redis): devolve o proprio snapshot
  const redis = { eval: jest.fn().mockResolvedValue([10, 5, 3, 1, 0]) };
  const service = new CampaignWebhookService(http as any, redis as any);

  return { service, http };
}

function campaign(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'camp-1',
    channel: '7-workspace1.beecrm.io',
    status: CampaignStatus.PROCESSING,
    metadata: { externalId: '99' },
    ...overrides,
  };
}

function postedUrls(http: { post: jest.Mock }): string[] {
  return http.post.mock.calls.map((call) => call[0]);
}

describe('CampaignWebhookService — destino do webhook', () => {
  const OLD_HOSTS = process.env.CRM_WEBHOOK_ALLOWED_HOSTS;
  const OLD_SECRET = process.env.CAMPAIGN_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.CAMPAIGN_WEBHOOK_SECRET = 'segredo-teste';
    process.env.CRM_WEBHOOK_ALLOWED_HOSTS = 'api.beecrm.io, APIES.beecrm.io';
  });

  afterEach(() => {
    process.env.CRM_WEBHOOK_ALLOWED_HOSTS = OLD_HOSTS;
    process.env.CAMPAIGN_WEBHOOK_SECRET = OLD_SECRET;
  });

  it('usa metadata.webhookUrl exatamente como veio quando o host esta permitido', async () => {
    const { service, http } = makeService();

    await service.sendUpdateStatus(campaign({ metadata: { externalId: '99', webhookUrl: SINGLE_URL } }));

    expect(postedUrls(http)).toEqual([SINGLE_URL]);
  });

  it('compara o host sem diferenciar maiusculas', async () => {
    const { service, http } = makeService();
    const url = 'https://apies.beecrm.io/api/v1/t/abc/webhooks/campaign-webhook';

    await service.sendUpdateStatus(campaign({ metadata: { webhookUrl: url } }));

    expect(postedUrls(http)).toEqual([url]);
  });

  it('manda o resumo e os resultados por mensagem para o mesmo destino', async () => {
    const { service, http } = makeService();
    const c = campaign({ metadata: { externalId: '99', webhookUrl: SINGLE_URL } });

    await service.sendBroadcastSummary(c, { totalContacts: 10, sentContacts: 5 });
    await service.sendMessageResults(c, []);

    expect(postedUrls(http)).toEqual([SINGLE_URL, SINGLE_URL]);
  });

  it('host fora da lista cai no calculo antigo pelo channel', async () => {
    const { service, http } = makeService();

    await service.sendUpdateStatus(
      campaign({ metadata: { webhookUrl: 'https://evil.example/api/v1/webhooks/campaign-webhook' } }),
    );

    expect(postedUrls(http)).toEqual(['https://workspace1.beecrm.io/api/v1/webhooks/campaign-webhook']);
  });

  it('sem lista de hosts configurada, recusa o webhookUrl (fail closed)', async () => {
    delete process.env.CRM_WEBHOOK_ALLOWED_HOSTS;
    const { service, http } = makeService();

    await service.sendUpdateStatus(campaign({ metadata: { webhookUrl: SINGLE_URL } }));

    expect(postedUrls(http)).toEqual(['https://workspace1.beecrm.io/api/v1/webhooks/campaign-webhook']);
  });

  it('recusa webhookUrl sem TLS mesmo com host permitido', async () => {
    const { service, http } = makeService();

    await service.sendUpdateStatus(
      campaign({ metadata: { webhookUrl: 'http://api.beecrm.io/api/v1/t/abc/webhooks/campaign-webhook' } }),
    );

    expect(postedUrls(http)).toEqual(['https://workspace1.beecrm.io/api/v1/webhooks/campaign-webhook']);
  });

  it('webhookUrl invalido nao derruba o envio: cai no calculo antigo', async () => {
    const { service, http } = makeService();

    await service.sendUpdateStatus(campaign({ metadata: { webhookUrl: 'nao e url' } }));

    expect(postedUrls(http)).toEqual(['https://workspace1.beecrm.io/api/v1/webhooks/campaign-webhook']);
  });

  it('campanha antiga sem webhookUrl segue com a URL pelo dominio do channel', async () => {
    const { service, http } = makeService();

    await service.sendUpdateStatus(campaign({ metadata: null }));

    expect(postedUrls(http)).toEqual(['https://workspace1.beecrm.io/api/v1/webhooks/campaign-webhook']);
  });

  it('campanha RCS (channel "rcs") passa a ter webhook com o webhookUrl', async () => {
    const { service, http } = makeService();

    await service.sendUpdateStatus(campaign({ channel: 'rcs', metadata: { webhookUrl: SINGLE_URL } }));

    expect(postedUrls(http)).toEqual([SINGLE_URL]);
  });

  it('campanha RCS sem webhookUrl continua sem destino e nao envia nada', async () => {
    const { service, http } = makeService();

    await service.sendUpdateStatus(campaign({ channel: 'rcs', metadata: null }));

    expect(http.post).not.toHaveBeenCalled();
  });
});
