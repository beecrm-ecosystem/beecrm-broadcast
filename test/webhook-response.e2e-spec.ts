import { WebhookService } from '../src/broadcast/webhook/webhook.service';

describe('WebhookService - response tracking', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should persist incoming responses and update campaign counters', async () => {
    const campaignId = 'campaign-1';
    const recipientId = 'recipient-1';
    const outboundMessageId = 'outbound-message-1';
    const inboundTimestampSeconds = Number('1697234567');
    const sentAt = new Date((inboundTimestampSeconds - 300) * 1000);
    const expectedResponseTimeSeconds = 300;

    const existingMessage = {
      id: outboundMessageId,
      campaignId,
      campaign: { id: campaignId },
      recipientId,
      recipient: {
        id: recipientId,
        respondedAt: null,
        sentAt,
        createdAt: new Date(sentAt.getTime() - 60_000),
      },
      sentAt,
      queuedAt: sentAt,
      createdAt: sentAt,
    };

    const prismaMock = {
      message: {
        findFirst: jest.fn().mockResolvedValueOnce(existingMessage).mockResolvedValueOnce(null),
      },
      campaignRecipient: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue(null),
      },
      campaign: {
        update: jest.fn().mockResolvedValue(null),
      },
      campaignResponse: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(null),
      },
    };

    const service = new WebhookService(prismaMock as any);

    const inboundMessage = {
      id: 'wamid.incoming.1',
      from: '5511999999999',
      timestamp: '1697234567',
      type: 'text',
      text: {
        body: 'Olá, quero saber mais',
      },
      context: {
        id: outboundMessageId,
      },
    };

    const metadata = {
      display_phone_number: '5511988887777',
      phone_number_id: 'phone-number-1',
    };

    await service.processMetaMessage(inboundMessage as any, metadata);

    // Should verify duplicate guard was queried
    expect(prismaMock.campaignResponse.findUnique).toHaveBeenCalledWith({
      where: { whatsappMessageId: inboundMessage.id },
    });

    expect(prismaMock.message.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { whatsappMessageId: inboundMessage.context?.id },
          { externalId: inboundMessage.context?.id },
        ],
      },
      include: { campaign: true, recipient: true },
    });

    const expectedTimestampIso = new Date(Number(inboundMessage.timestamp) * 1000).toISOString();

    expect(prismaMock.campaignResponse.create).toHaveBeenCalledTimes(1);
    const createArgs = prismaMock.campaignResponse.create.mock.calls[0][0];
    expect(createArgs.data).toMatchObject({
      campaignId,
      recipientId,
      messageId: outboundMessageId,
      whatsappMessageId: inboundMessage.id,
      fromPhone: '5511999999999',
      responseType: 'text',
      textBody: inboundMessage.text.body,
      mediaUrl: null,
      metadata: expect.objectContaining({
        displayPhoneNumber: metadata.display_phone_number,
        phoneNumberId: metadata.phone_number_id,
        optOutDetected: false,
      }),
      responsePayload: inboundMessage,
      responseTimeSeconds: expectedResponseTimeSeconds,
    });
    expect(createArgs.data.metadata).not.toHaveProperty('optOutReason');
    expect(createArgs.data.receivedAt).toBeInstanceOf(Date);
    expect(createArgs.data.receivedAt.toISOString()).toBe(expectedTimestampIso);

    expect(prismaMock.campaignRecipient.update).toHaveBeenCalledWith({
      where: { id: recipientId },
      data: expect.objectContaining({
        responseCount: { increment: 1 },
        lastResponseAt: expect.any(Date),
        respondedAt: expect.any(Date),
        firstResponseTimeSeconds: expectedResponseTimeSeconds,
      }),
    });
    const recipientUpdateArgs = prismaMock.campaignRecipient.update.mock.calls[0][0];
    const recipientUpdateData = recipientUpdateArgs.data as Record<string, any>;
    expect((recipientUpdateData.lastResponseAt as Date).toISOString()).toBe(expectedTimestampIso);
    expect((recipientUpdateData.respondedAt as Date).toISOString()).toBe(expectedTimestampIso);

    expect(prismaMock.campaign.update).toHaveBeenCalledWith({
      where: { id: campaignId },
      data: expect.objectContaining({
        responsesCount: { increment: 1 },
        lastResponseAt: expect.any(Date),
        respondedCount: { increment: 1 },
        responseTimeTotalSeconds: { increment: expectedResponseTimeSeconds },
      }),
    });
    const campaignUpdateArgs = prismaMock.campaign.update.mock.calls[0][0];
    const campaignUpdateData = campaignUpdateArgs.data as Record<string, any>;
    expect((campaignUpdateData.lastResponseAt as Date).toISOString()).toBe(expectedTimestampIso);
    expect(campaignUpdateData.responseTimeTotalSeconds).toEqual({
      increment: expectedResponseTimeSeconds,
    });

    console.log('📊 Metrics snapshot', {
      campaign: {
        responsesCount: campaignUpdateData.responsesCount,
        respondedCount: campaignUpdateData.respondedCount,
        lastResponseAt: (campaignUpdateData.lastResponseAt as Date).toISOString(),
        responseTimeTotalSeconds: campaignUpdateData.responseTimeTotalSeconds,
      },
      recipient: {
        responseCount: recipientUpdateData.responseCount,
        respondedAt: (recipientUpdateData.respondedAt as Date).toISOString(),
        lastResponseAt: (recipientUpdateData.lastResponseAt as Date).toISOString(),
        firstResponseTimeSeconds: recipientUpdateData.firstResponseTimeSeconds,
      },
    });
  });

  it('should detect opt-out keywords and mark the recipient as inactive', async () => {
    const campaignId = 'campaign-optout';
    const recipientId = 'recipient-optout';
    const outboundMessageId = 'outbound-optout';
    const inboundTimestampSeconds = Number('1698000000');
    const sentAt = new Date((inboundTimestampSeconds - 120) * 1000);

    const existingMessage = {
      id: outboundMessageId,
      campaignId,
      campaign: { id: campaignId },
      recipientId,
      recipient: {
        id: recipientId,
        respondedAt: null,
        sentAt,
        createdAt: new Date(sentAt.getTime() - 60_000),
        optedOut: false,
      },
      sentAt,
      queuedAt: sentAt,
      createdAt: sentAt,
    };

    const recipientUpdates: any[] = [];
    const campaignUpdates: any[] = [];

    const prismaMock = {
      message: {
        findFirst: jest.fn().mockResolvedValue(existingMessage),
      },
      campaignRecipient: {
        findFirst: jest.fn(),
        update: jest.fn().mockImplementation((args) => {
          recipientUpdates.push(args);
          return Promise.resolve(null);
        }),
      },
      campaign: {
        update: jest.fn().mockImplementation((args) => {
          campaignUpdates.push(args);
          return Promise.resolve(null);
        }),
      },
      campaignResponse: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(null),
      },
    };

    const service = new WebhookService(prismaMock as any);

    const inboundMessage = {
      id: 'wamid.incoming.optout',
      from: '5511888777666',
      timestamp: String(inboundTimestampSeconds),
      type: 'text',
      text: {
        body: 'Stop agora',
      },
      context: {
        id: outboundMessageId,
      },
    };

    const metadata = {
      display_phone_number: '5511988887777',
      phone_number_id: 'phone-number-1',
    };

    await service.processMetaMessage(inboundMessage as any, metadata);

    expect(prismaMock.campaignResponse.create).toHaveBeenCalledTimes(1);
    const createArgs = prismaMock.campaignResponse.create.mock.calls[0][0];
    expect(createArgs.data.metadata).toMatchObject({
      optOutDetected: true,
      optOutReason: 'STOP',
    });

    expect(recipientUpdates.length).toBeGreaterThanOrEqual(2);
    const optOutRecipientUpdate = recipientUpdates.find((entry) => entry.data?.optedOut === true);
    expect(optOutRecipientUpdate).toBeDefined();
    expect(optOutRecipientUpdate?.data).toMatchObject({
      optedOut: true,
      optOutReason: 'STOP',
      isActive: false,
      optedOutAt: expect.any(Date),
    });

    const optOutCampaignUpdate = campaignUpdates.find(
      (entry) => entry.data?.optOutCount?.increment === 1,
    );
    expect(optOutCampaignUpdate).toBeDefined();

    console.log('🚫 Opt-out detection snapshot', {
      recipientUpdates: recipientUpdates.map((entry) => entry.data),
      campaignUpdates: campaignUpdates.map((entry) => entry.data),
      metadata: createArgs.data.metadata,
    });
  });

  it('should ignore duplicated incoming message ids', async () => {
    const prismaMock = {
      campaignResponse: {
        findUnique: jest.fn().mockResolvedValue({ id: 'existing-response' }),
      },
    };

    const service = new WebhookService(prismaMock as any);

    const inboundMessage = {
      id: 'wamid.incoming.2',
      from: '5511888777666',
      timestamp: '1697234999',
      type: 'text',
      text: { body: 'Ainda tenho dúvidas' },
    };

    await service.processMetaMessage(inboundMessage as any, {
      display_phone_number: '5511988887777',
      phone_number_id: 'phone-number-1',
    });

    expect(prismaMock.campaignResponse.findUnique).toHaveBeenCalledTimes(1);
    expect((prismaMock.campaignResponse as any).create).toBeUndefined();
  });

  it('should handle multiple responses from same recipient', async () => {
    const campaignId = 'campaign-multi';
    const recipientId = 'recipient-multi';
    const outboundMessageId = 'outbound-message-multi';
    const baseTimestampSeconds = Number('1697234567');
    const initialSentAt = new Date((baseTimestampSeconds - 300) * 1000);

    const existingMessage: any = {
      id: outboundMessageId,
      campaignId,
      campaign: { id: campaignId },
      recipientId,
      recipient: {
        id: recipientId,
        respondedAt: null,
        responseCount: 0,
        sentAt: initialSentAt,
        createdAt: new Date(initialSentAt.getTime() - 60_000),
      },
      sentAt: initialSentAt,
      queuedAt: initialSentAt,
      createdAt: initialSentAt,
    };

    let campaignResponsesCount = 0;
    let campaignRespondedCount = 0;
    let recipientResponseCount = 0;
    let recipientRespondedAt: Date | null = null as Date | null;
    let campaignResponseTimeTotal = 0;
    let recipientFirstResponseTimeSeconds: number | null = null;
    const allResponseTimes: number[] = [];

    const prismaMock = {
      message: {
        findFirst: jest.fn().mockResolvedValue(existingMessage),
      },
      campaignRecipient: {
        findFirst: jest.fn(),
        update: jest.fn().mockImplementation((args) => {
          const data = args.data;
          if (data.responseCount?.increment) {
            recipientResponseCount += data.responseCount.increment;
          }
          if (data.respondedAt) {
            recipientRespondedAt = data.respondedAt;
          }
          if (typeof data.firstResponseTimeSeconds === 'number') {
            recipientFirstResponseTimeSeconds = data.firstResponseTimeSeconds;
          }
          return Promise.resolve(null);
        }),
      },
      campaign: {
        update: jest.fn().mockImplementation((args) => {
          const data = args.data;
          if (data.responsesCount?.increment) {
            campaignResponsesCount += data.responsesCount.increment;
          }
          if (data.respondedCount?.increment) {
            campaignRespondedCount += data.respondedCount.increment;
          }
          if (data.responseTimeTotalSeconds?.increment) {
            campaignResponseTimeTotal += data.responseTimeTotalSeconds.increment;
          }
          return Promise.resolve(null);
        }),
      },
      campaignResponse: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((args) => {
          const responseTime = args.data.responseTimeSeconds;
          if (typeof responseTime === 'number') {
            allResponseTimes.push(responseTime);
          }
          return Promise.resolve(null);
        }),
      },
    };

    const service = new WebhookService(prismaMock as any);

    const metadata = {
      display_phone_number: '5511988887777',
      phone_number_id: 'phone-number-1',
    };

    // 10 respostas do mesmo destinatário
    const responses = [
      { id: 'wamid.multi.1', timestamp: '1697234567', body: 'Resposta 1', type: 'text' }, // +300s
      { id: 'wamid.multi.2', timestamp: '1697234580', body: 'Resposta 2', type: 'text' }, // +313s
      { id: 'wamid.multi.3', timestamp: '1697234600', body: 'Resposta 3', type: 'text' }, // +333s
      { id: 'wamid.multi.4', timestamp: '1697234650', body: 'Resposta 4', type: 'text' }, // +383s
      { id: 'wamid.multi.5', timestamp: '1697234700', body: 'Resposta 5', type: 'text' }, // +433s
      { id: 'wamid.multi.6', timestamp: '1697234800', body: 'Resposta 6', type: 'text' }, // +533s
      { id: 'wamid.multi.7', timestamp: '1697234900', body: 'Resposta 7', type: 'text' }, // +633s
      { id: 'wamid.multi.8', timestamp: '1697235000', body: 'Resposta 8', type: 'text' }, // +733s
      {
        id: 'wamid.multi.9',
        timestamp: '1697235100',
        body: 'Sim, confirmo',
        type: 'interactive',
      }, // +833s
      { id: 'wamid.multi.10', timestamp: '1697235200', body: 'Obrigado!', type: 'text' }, // +933s
    ];

    for (let i = 0; i < responses.length; i++) {
      const resp = responses[i];

      // Atualiza estado do recipient após primeira resposta
      if (i === 1) {
        existingMessage.recipient.respondedAt = new Date('2023-10-13T22:02:47.000Z');
        existingMessage.recipient.firstResponseTimeSeconds = 300;
      }
      existingMessage.recipient.responseCount = i;

      const inboundMessage: any = {
        id: resp.id,
        from: '5511999888777',
        timestamp: resp.timestamp,
        type: resp.type === 'interactive' ? 'interactive' : 'text',
        context: { id: outboundMessageId },
      };

      if (resp.type === 'interactive') {
        inboundMessage.interactive = {
          type: 'button_reply',
          button_reply: {
            id: 'btn_confirm',
            title: resp.body,
          },
        };
      } else {
        inboundMessage.text = { body: resp.body };
      }

      await service.processMetaMessage(inboundMessage, metadata);
    }

    // Verifica que 10 respostas foram criadas
    expect(prismaMock.campaignResponse.create).toHaveBeenCalledTimes(10);

    // Verifica primeira resposta
    const create1Args = prismaMock.campaignResponse.create.mock.calls[0][0];
    expect(create1Args.data).toMatchObject({
      campaignId,
      recipientId,
      messageId: outboundMessageId,
      whatsappMessageId: responses[0].id,
      fromPhone: '5511999888777',
      responseType: 'text',
      textBody: responses[0].body,
      responseTimeSeconds: 300,
    });

    // Verifica última resposta
    const create10Args = prismaMock.campaignResponse.create.mock.calls[9][0];
    expect(create10Args.data).toMatchObject({
      whatsappMessageId: responses[9].id,
      textBody: responses[9].body,
      responseTimeSeconds: 933,
    });

    // Verifica contadores acumulados
    expect(recipientResponseCount).toBe(10);
    expect(campaignResponsesCount).toBe(10);
    expect(campaignRespondedCount).toBe(1); // Só incrementa na primeira vez
    expect(recipientRespondedAt).not.toBeNull();
    expect(recipientFirstResponseTimeSeconds).toBe(300);
    expect(campaignResponseTimeTotal).toBe(300); // Apenas primeira resposta conta

    console.log('📊 Multiple responses metrics (10 messages)', {
      totalResponses: 10,
      campaign: {
        responsesCount: campaignResponsesCount,
        respondedCount: campaignRespondedCount,
        responseTimeTotalSeconds: campaignResponseTimeTotal,
        averageResponseTime: campaignResponseTimeTotal / campaignRespondedCount,
      },
      recipient: {
        responseCount: recipientResponseCount,
        respondedAtFirstTime:
          recipientRespondedAt instanceof Date ? recipientRespondedAt.toISOString() : null,
        firstResponseTimeSeconds: recipientFirstResponseTimeSeconds,
      },
      allResponseTimes,
      responseTypes: responses.map((r) => r.type),
    });
  });
});
