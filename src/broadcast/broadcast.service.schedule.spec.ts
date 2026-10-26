/**
 * Regressao do BC-05 (auditoria de campanhas de 26/10/2026).
 *
 * O CRM manda `startDate` como Carbon serializado em UTC correto (15:00 em Sao Paulo
 * vira `2031-01-01T18:00:00.000000Z`) e, no PUT da janela de horario, `scheduledAt`
 * via `toIso8601String()` (`...-03:00`). O broadcast somava -180 min a todo instante
 * com `Z`/`+00:00`, entao a campanha disparava 3 h antes e agendar para menos de 3 h
 * a frente era recusado. A regra agora: offset explicito e respeitado como veio;
 * so string SEM offset e lida como hora local de Sao Paulo.
 */
import { Logger } from '@nestjs/common';
import { BroadcastService } from './broadcast.service';

Logger.overrideLogger(false);

// 15:00 em Sao Paulo == 18:00 UTC
const EXPECTED_INSTANT = '2031-01-01T18:00:00.000Z';

function makeService(existingStatus = 'DRAFT') {
  const prisma: any = {
    campaign: {
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'camp-1', ...data })),
      findUnique: jest.fn().mockResolvedValue({ id: 'camp-1', status: existingStatus }),
      update: jest.fn(({ data }: any) => Promise.resolve({ id: 'camp-1', ...data })),
    },
  };
  const queueService: any = {};
  const campaignWebhook: any = { sendUpdateStatus: jest.fn().mockResolvedValue(undefined) };
  const campaignScheduler: any = {
    scheduleCampaign: jest.fn().mockResolvedValue(undefined),
    cancelScheduledCampaign: jest.fn().mockResolvedValue(undefined),
  };
  const service = new BroadcastService(prisma, queueService, campaignWebhook, campaignScheduler);
  return { service, prisma, campaignScheduler };
}

async function createWithStartDate(startDate: string) {
  const ctx = makeService();
  await ctx.service.createCampaign({
    name: 'Regressao BC-05',
    template: { name: 'tpl', language: 'pt_BR', components: [] },
    channel: '7-tenant.example',
    startDate,
  } as any);
  const stored: Date = ctx.prisma.campaign.create.mock.calls[0][0].data.scheduledAt;
  const scheduled: Date = ctx.campaignScheduler.scheduleCampaign.mock.calls[0][0].startAt;
  return { stored, scheduled };
}

describe('BroadcastService — instante de agendamento (BC-05)', () => {
  describe('createCampaign com startDate', () => {
    it.each([
      ['Carbon serializado pelo CRM (Z com microssegundos)', '2031-01-01T18:00:00.000000Z'],
      ['Z com milissegundos', '2031-01-01T18:00:00.000Z'],
      ['Z sem fracao', '2031-01-01T18:00:00Z'],
      ['z minusculo', '2031-01-01T18:00:00z'],
      ['offset +00:00', '2031-01-01T18:00:00+00:00'],
      ['offset +0000 sem dois-pontos', '2031-01-01T18:00:00+0000'],
      ['offset -03:00 (toIso8601String do CRM)', '2031-01-01T15:00:00-03:00'],
      ['offset -0300 sem dois-pontos', '2031-01-01T15:00:00-0300'],
      ['outro offset (+01:00)', '2031-01-01T19:00:00+01:00'],
      ['sem offset: hora local de Sao Paulo', '2031-01-01T15:00:00'],
      ['sem offset com espaco: hora local de Sao Paulo', '2031-01-01 15:00:00'],
    ])('keeps the same instant for %s', async (_label, input) => {
      const { stored, scheduled } = await createWithStartDate(input);

      expect(stored.toISOString()).toBe(EXPECTED_INSTANT);
      // o job do scheduler usa exatamente o mesmo instante gravado no banco
      expect(scheduled.getTime()).toBe(stored.getTime());
    });

    it('does not shift a UTC instant by the Sao Paulo offset', async () => {
      // Caso literal da reproducao da auditoria: antes virava 09:00Z.
      const { stored } = await createWithStartDate('2031-01-01T12:00:00.000Z');

      expect(stored.toISOString()).toBe('2031-01-01T12:00:00.000Z');
    });

    it('accepts a UTC instant one hour ahead and stores that exact instant', async () => {
      const oneHourAhead = new Date(Date.now() + 60 * 60_000);
      oneHourAhead.setUTCMilliseconds(0);

      const { stored, scheduled } = await createWithStartDate(oneHourAhead.toISOString());

      expect(stored.getTime()).toBe(oneHourAhead.getTime());
      expect(scheduled.getTime()).toBe(oneHourAhead.getTime());
    });

    it('rejects a UTC instant in the past (positive control of the future check)', async () => {
      const { service, prisma } = makeService();
      const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();

      await expect(
        service.createCampaign({
          name: 'Regressao BC-05',
          template: { name: 'tpl', language: 'pt_BR', components: [] },
          channel: '7-tenant.example',
          startDate: oneHourAgo,
        } as any),
      ).rejects.toThrow('A data de início deve estar no futuro.');
      expect(prisma.campaign.create).not.toHaveBeenCalled();
    });
  });

  describe('createCampaign com scheduledAt (alternativa ao startDate)', () => {
    it('keeps a UTC scheduledAt as sent', async () => {
      const { service, prisma } = makeService();

      await service.createCampaign({
        name: 'Regressao BC-05',
        template: { name: 'tpl', language: 'pt_BR', components: [] },
        channel: '7-tenant.example',
        scheduledAt: '2031-01-01T18:00:00.000000Z',
      } as any);

      expect(prisma.campaign.create.mock.calls[0][0].data.scheduledAt.toISOString()).toBe(
        EXPECTED_INSTANT,
      );
    });
  });

  describe('updateCampaign (PUT /:id)', () => {
    it('keeps the scheduledAt sent by the CRM time-window path (-03:00)', async () => {
      const { service, prisma, campaignScheduler } = makeService();

      await service.updateCampaign('camp-1', { scheduledAt: '2031-01-01T15:00:00-03:00' } as any);

      const data = prisma.campaign.update.mock.calls[0][0].data;
      expect(data.scheduledAt.toISOString()).toBe(EXPECTED_INSTANT);
      expect(campaignScheduler.scheduleCampaign).toHaveBeenCalledWith({
        campaignId: 'camp-1',
        startAt: new Date(EXPECTED_INSTANT),
      });
    });

    it('keeps a UTC startDate as sent', async () => {
      const { service, prisma } = makeService('SCHEDULED');

      await service.updateCampaign('camp-1', { startDate: '2031-01-01T18:00:00+00:00' } as any);

      expect(prisma.campaign.update.mock.calls[0][0].data.scheduledAt.toISOString()).toBe(
        EXPECTED_INSTANT,
      );
    });

    it('accepts a UTC instant one hour ahead', async () => {
      const { service, prisma } = makeService();
      const oneHourAhead = new Date(Date.now() + 60 * 60_000);
      oneHourAhead.setUTCMilliseconds(0);

      await service.updateCampaign('camp-1', { scheduledAt: oneHourAhead.toISOString() } as any);

      expect(prisma.campaign.update.mock.calls[0][0].data.scheduledAt.getTime()).toBe(
        oneHourAhead.getTime(),
      );
    });
  });
});
