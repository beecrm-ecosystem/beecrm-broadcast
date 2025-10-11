import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed do banco de dados...');

  // Limpar dados existentes (opcional - comente se não quiser limpar)
  console.log('🧹 Limpando dados antigos...');
  await prisma.webhookEvent.deleteMany();
  await prisma.message.deleteMany();
  await prisma.campaignRecipient.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.templateButton.deleteMany();
  await prisma.templateComponent.deleteMany();
  await prisma.messageTemplate.deleteMany();

  // ==================== TEMPLATES ====================
  console.log('📝 Criando templates de mensagem...');

  // Template 1: Confirmação de Pedido
  const templatePedido = await prisma.messageTemplate.create({
    data: {
      name: 'confirmacao_pedido',
      language: 'pt_BR',
      category: 'UTILITY',
      status: 'APPROVED',
      whatsappTemplateId: 'waba_template_pedido_123',
      description: 'Template para confirmação de pedidos',
      tags: ['pedido', 'confirmacao', 'ecommerce'],
      components: {
        create: [
          {
            type: 'HEADER',
            format: 'TEXT',
            text: '✅ Pedido Confirmado',
            order: 0,
          },
          {
            type: 'BODY',
            text: 'Olá {{1}}! 🎉\n\nSeu pedido *#{{2}}* foi confirmado com sucesso.\n\nProduto: {{3}}\nValor: R$ {{4}}\n\nPrevisão de entrega: {{5}}',
            example: {
              body_text: [
                [
                  { text: 'João Silva' },
                  { text: '12345' },
                  { text: 'Notebook Dell' },
                  { text: '3.499,90' },
                  { text: '5 dias úteis' },
                ],
              ],
            },
            order: 1,
          },
          {
            type: 'FOOTER',
            text: 'Obrigado por comprar conosco! 💚',
            order: 2,
          },
          {
            type: 'BUTTONS',
            order: 3,
            buttons: {
              create: [
                {
                  type: 'URL',
                  text: 'Rastrear Pedido',
                  url: 'https://loja.com/pedido/{{1}}',
                  order: 0,
                },
                {
                  type: 'PHONE_NUMBER',
                  text: 'Falar com Suporte',
                  phoneNumber: '+551140041234',
                  order: 1,
                },
              ],
            },
          },
        ],
      },
    },
  });

  // Template 2: Promoção Marketing
  const templatePromocao = await prisma.messageTemplate.create({
    data: {
      name: 'promocao_black_friday',
      language: 'pt_BR',
      category: 'MARKETING',
      status: 'APPROVED',
      whatsappTemplateId: 'waba_template_promo_456',
      description: 'Template para campanhas de promoção',
      tags: ['marketing', 'promocao', 'black-friday'],
      components: {
        create: [
          {
            type: 'HEADER',
            format: 'IMAGE',
            text: 'black_friday_banner.jpg',
            order: 0,
          },
          {
            type: 'BODY',
            text: 'Oi {{1}}! 🔥\n\n*BLACK FRIDAY EXCLUSIVA!*\n\nDesconto de *{{2}}%* em toda a loja!\n\nCódigo: *{{3}}*\nVálido até: {{4}}\n\nNão perca essa oportunidade! 🛍️',
            example: {
              body_text: [
                [{ text: 'Maria' }, { text: '50' }, { text: 'BF2025' }, { text: '30/11/2025' }],
              ],
            },
            order: 1,
          },
          {
            type: 'FOOTER',
            text: 'Oferta por tempo limitado',
            order: 2,
          },
          {
            type: 'BUTTONS',
            order: 3,
            buttons: {
              create: [
                {
                  type: 'URL',
                  text: 'Ver Ofertas',
                  url: 'https://loja.com/black-friday',
                  order: 0,
                },
                {
                  type: 'QUICK_REPLY',
                  text: 'Quero saber mais',
                  order: 1,
                },
              ],
            },
          },
        ],
      },
    },
  });

  // Template 3: Lembrete de Carrinho Abandonado
  const templateCarrinho = await prisma.messageTemplate.create({
    data: {
      name: 'carrinho_abandonado',
      language: 'pt_BR',
      category: 'MARKETING',
      status: 'APPROVED',
      whatsappTemplateId: 'waba_template_carrinho_789',
      description: 'Template para recuperação de carrinho abandonado',
      tags: ['marketing', 'carrinho', 'recuperacao'],
      components: {
        create: [
          {
            type: 'HEADER',
            format: 'TEXT',
            text: '🛒 Você esqueceu algo!',
            order: 0,
          },
          {
            type: 'BODY',
            text: 'Olá {{1}}! 😊\n\nNotamos que você deixou {{2}} itens no carrinho.\n\nValor total: R$ {{3}}\n\n*Aproveite:* Use o cupom *{{4}}* e ganhe {{5}}% de desconto!\n\nSeus itens estão te esperando! ⏰',
            example: {
              body_text: [
                [
                  { text: 'Carlos' },
                  { text: '3' },
                  { text: '459,90' },
                  { text: 'VOLTA10' },
                  { text: '10' },
                ],
              ],
            },
            order: 1,
          },
          {
            type: 'BUTTONS',
            order: 2,
            buttons: {
              create: [
                {
                  type: 'URL',
                  text: 'Finalizar Compra',
                  url: 'https://loja.com/carrinho',
                  order: 0,
                },
              ],
            },
          },
        ],
      },
    },
  });

  // Template 4: Código de Verificação
  await prisma.messageTemplate.create({
    data: {
      name: 'codigo_verificacao',
      language: 'pt_BR',
      category: 'AUTHENTICATION',
      status: 'APPROVED',
      whatsappTemplateId: 'waba_template_auth_101',
      description: 'Template para códigos de autenticação',
      tags: ['autenticacao', 'seguranca', 'codigo'],
      components: {
        create: [
          {
            type: 'BODY',
            text: '🔐 Seu código de verificação é:\n\n*{{1}}*\n\nEste código expira em {{2}} minutos.\n\nNão compartilhe este código com ninguém.',
            example: {
              body_text: [[{ text: '123456' }, { text: '5' }]],
            },
            order: 0,
          },
        ],
      },
    },
  });

  console.log(`✅ ${4} templates criados!`);

  // ==================== CAMPANHAS ====================
  console.log('🚀 Criando campanhas de exemplo...');

  // Campanha 1: Black Friday (Draft)
  const campanhaBlackFriday = await prisma.campaign.create({
    data: {
      name: 'Black Friday 2025',
      description: 'Campanha de ofertas especiais para Black Friday com 50% de desconto',
      status: 'DRAFT',
      templateId: templatePromocao.id,
      templateData: {
        name: templatePromocao.name,
        language: templatePromocao.language,
        category: templatePromocao.category,
      },
      channel: 'whatsapp',
      phoneNumberId: '123456789',
      scheduledAt: new Date('2025-11-29T00:00:00Z'),
      batchSize: 100,
      delayBetweenBatches: 5000,
      tags: ['black-friday', 'promocao', '2025'],
      metadata: {
        discount: 50,
        campaign_type: 'promotional',
        budget: 10000,
        responsible: 'Marketing Team',
      },
    },
  });

  // Campanha 2: Confirmações de Pedido (Ativa)
  const campanhaConfirmacoes = await prisma.campaign.create({
    data: {
      name: 'Confirmações Automáticas',
      description: 'Envio automático de confirmações de pedidos',
      status: 'PROCESSING',
      templateId: templatePedido.id,
      templateData: {
        name: templatePedido.name,
        language: templatePedido.language,
        category: templatePedido.category,
      },
      channel: 'whatsapp',
      phoneNumberId: '123456789',
      startedAt: new Date('2025-10-01T00:00:00Z'),
      batchSize: 50,
      delayBetweenBatches: 2000,
      tags: ['automatico', 'pedidos', 'transacional'],
      totalRecipients: 150,
      sentCount: 120,
      deliveredCount: 115,
      readCount: 95,
      failedCount: 5,
      metadata: {
        campaign_type: 'transactional',
        auto_send: true,
      },
    },
  });

  // Campanha 3: Recuperação de Carrinho (Agendada)
  const campanhaCarrinho = await prisma.campaign.create({
    data: {
      name: 'Recuperação de Carrinhos - Outubro',
      description: 'Campanha para recuperar carrinhos abandonados',
      status: 'SCHEDULED',
      templateId: templateCarrinho.id,
      templateData: {
        name: templateCarrinho.name,
        language: templateCarrinho.language,
        category: templateCarrinho.category,
      },
      channel: 'whatsapp',
      phoneNumberId: '123456789',
      scheduledAt: new Date('2025-10-10T09:00:00Z'),
      batchSize: 75,
      delayBetweenBatches: 3000,
      tags: ['carrinho', 'recuperacao', 'outubro'],
      metadata: {
        campaign_type: 'recovery',
        target_period: 'last_7_days',
      },
    },
  });

  // Campanha 4: Completada
  await prisma.campaign.create({
    data: {
      name: 'Lançamento Produto X - Setembro',
      description: 'Campanha de lançamento concluída',
      status: 'COMPLETED',
      templateId: templatePromocao.id,
      templateData: {
        name: templatePromocao.name,
        language: templatePromocao.language,
        category: templatePromocao.category,
      },
      channel: 'whatsapp',
      phoneNumberId: '123456789',
      startedAt: new Date('2025-09-15T10:00:00Z'),
      completedAt: new Date('2025-09-15T18:30:00Z'),
      batchSize: 100,
      delayBetweenBatches: 5000,
      tags: ['lancamento', 'produto-x', 'setembro'],
      totalRecipients: 500,
      sentCount: 495,
      deliveredCount: 480,
      readCount: 420,
      failedCount: 5,
      metadata: {
        campaign_type: 'launch',
        product_id: 'PROD-X-001',
      },
    },
  });

  console.log(`✅ ${4} campanhas criadas!`);

  // ==================== DESTINATÁRIOS ====================
  console.log('👥 Criando destinatários...');

  // Destinatários para Black Friday
  const recipientesBlackFriday = [
    {
      campaignId: campanhaBlackFriday.id,
      phoneNumber: '5511999999999',
      name: 'João Silva',
      email: 'joao.silva@email.com',
      variables: {
        '1': 'João',
        '2': '50',
        '3': 'BF2025',
        '4': '30/11/2025',
      },
      metadata: {
        segment: 'premium',
        city: 'São Paulo',
        lastPurchase: '2025-09-15',
      },
    },
    {
      campaignId: campanhaBlackFriday.id,
      phoneNumber: '5511988888888',
      name: 'Maria Santos',
      email: 'maria.santos@email.com',
      variables: {
        '1': 'Maria',
        '2': '50',
        '3': 'BF2025',
        '4': '30/11/2025',
      },
      metadata: {
        segment: 'standard',
        city: 'Rio de Janeiro',
      },
    },
    {
      campaignId: campanhaBlackFriday.id,
      phoneNumber: '5511977777777',
      name: 'Carlos Oliveira',
      email: 'carlos.oliveira@email.com',
      variables: {
        '1': 'Carlos',
        '2': '50',
        '3': 'BF2025',
        '4': '30/11/2025',
      },
      metadata: {
        segment: 'premium',
        city: 'Belo Horizonte',
        vip: true,
      },
    },
    {
      campaignId: campanhaBlackFriday.id,
      phoneNumber: '5511966666666',
      name: 'Ana Paula Costa',
      email: 'ana.costa@email.com',
      variables: {
        '1': 'Ana Paula',
        '2': '50',
        '3': 'BF2025',
        '4': '30/11/2025',
      },
      metadata: {
        segment: 'standard',
        city: 'Curitiba',
      },
    },
    {
      campaignId: campanhaBlackFriday.id,
      phoneNumber: '5511955555555',
      name: 'Pedro Henrique',
      email: 'pedro.henrique@email.com',
      variables: {
        '1': 'Pedro',
        '2': '50',
        '3': 'BF2025',
        '4': '30/11/2025',
      },
      metadata: {
        segment: 'premium',
        city: 'Porto Alegre',
      },
    },
  ];

  await prisma.campaignRecipient.createMany({
    data: recipientesBlackFriday,
  });

  // Atualizar contador da campanha Black Friday
  await prisma.campaign.update({
    where: { id: campanhaBlackFriday.id },
    data: { totalRecipients: recipientesBlackFriday.length },
  });

  // Destinatários para Recuperação de Carrinho
  const recipientesCarrinho = [
    {
      campaignId: campanhaCarrinho.id,
      phoneNumber: '5511944444444',
      name: 'Juliana Martins',
      email: 'juliana.martins@email.com',
      variables: {
        '1': 'Juliana',
        '2': '2',
        '3': '289,90',
        '4': 'VOLTA10',
        '5': '10',
      },
      metadata: {
        cartValue: 289.9,
        itemsInCart: 2,
        abandonedAt: '2025-10-05',
      },
    },
    {
      campaignId: campanhaCarrinho.id,
      phoneNumber: '5511933333333',
      name: 'Roberto Lima',
      email: 'roberto.lima@email.com',
      variables: {
        '1': 'Roberto',
        '2': '4',
        '3': '759,80',
        '4': 'VOLTA10',
        '5': '10',
      },
      metadata: {
        cartValue: 759.8,
        itemsInCart: 4,
        abandonedAt: '2025-10-06',
      },
    },
    {
      campaignId: campanhaCarrinho.id,
      phoneNumber: '5511922222222',
      name: 'Fernanda Souza',
      email: 'fernanda.souza@email.com',
      variables: {
        '1': 'Fernanda',
        '2': '1',
        '3': '149,90',
        '4': 'VOLTA10',
        '5': '10',
      },
      metadata: {
        cartValue: 149.9,
        itemsInCart: 1,
        abandonedAt: '2025-10-07',
      },
    },
  ];

  await prisma.campaignRecipient.createMany({
    data: recipientesCarrinho,
  });

  // Atualizar contador da campanha Carrinho
  await prisma.campaign.update({
    where: { id: campanhaCarrinho.id },
    data: { totalRecipients: recipientesCarrinho.length },
  });

  console.log(
    `✅ ${recipientesBlackFriday.length + recipientesCarrinho.length} destinatários criados!`,
  );

  // ==================== MENSAGENS (exemplos) ====================
  console.log('📨 Criando mensagens de exemplo...');

  // Buscar alguns destinatários da campanha de confirmações
  const recipientConfirmacao = await prisma.campaignRecipient.create({
    data: {
      campaignId: campanhaConfirmacoes.id,
      phoneNumber: '5511911111111',
      name: 'Lucas Almeida',
      email: 'lucas.almeida@email.com',
      variables: {
        '1': 'Lucas Almeida',
        '2': '98765',
        '3': 'Smartphone Samsung',
        '4': '1.899,90',
        '5': '3 dias úteis',
      },
      metadata: {
        orderId: '98765',
        orderValue: 1899.9,
      },
    },
  });

  // Criar mensagens de exemplo
  const mensagens = [
    {
      campaignId: campanhaConfirmacoes.id,
      recipientId: recipientConfirmacao.id,
      phoneNumber: '5511911111111',
      status: 'READ' as const,
      whatsappMessageId: 'wamid_msg_001',
      wabaId: 'waba_123456',
      processedContent: {
        template_name: 'confirmacao_pedido',
        language: 'pt_BR',
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Lucas Almeida' },
              { type: 'text', text: '98765' },
              { type: 'text', text: 'Smartphone Samsung' },
              { type: 'text', text: '1.899,90' },
              { type: 'text', text: '3 dias úteis' },
            ],
          },
        ],
      },
      queuedAt: new Date('2025-10-07T10:00:00Z'),
      sentAt: new Date('2025-10-07T10:00:05Z'),
      deliveredAt: new Date('2025-10-07T10:00:10Z'),
      readAt: new Date('2025-10-07T10:05:30Z'),
      retryCount: 0,
      maxRetries: 3,
    },
  ];

  for (const msg of mensagens) {
    await prisma.message.create({ data: msg });
  }

  console.log(`✅ ${mensagens.length} mensagens criadas!`);

  // ==================== WEBHOOK EVENTS (exemplos) ====================
  console.log('🔔 Criando eventos de webhook...');

  const message = await prisma.message.findFirst({
    where: { whatsappMessageId: 'wamid_msg_001' },
  });

  if (message) {
    await prisma.webhookEvent.createMany({
      data: [
        {
          messageId: message.id,
          eventType: 'message_status',
          whatsappMessageId: 'wamid_msg_001',
          status: 'sent',
          timestamp: new Date('2025-10-07T10:00:05Z'),
          payload: {
            id: 'wamid_msg_001',
            status: 'sent',
            timestamp: '1696672805',
          },
          processed: true,
          processedAt: new Date('2025-10-07T10:00:06Z'),
        },
        {
          messageId: message.id,
          eventType: 'message_status',
          whatsappMessageId: 'wamid_msg_001',
          status: 'delivered',
          timestamp: new Date('2025-10-07T10:00:10Z'),
          payload: {
            id: 'wamid_msg_001',
            status: 'delivered',
            timestamp: '1696672810',
          },
          processed: true,
          processedAt: new Date('2025-10-07T10:00:11Z'),
        },
        {
          messageId: message.id,
          eventType: 'message_status',
          whatsappMessageId: 'wamid_msg_001',
          status: 'read',
          timestamp: new Date('2025-10-07T10:05:30Z'),
          payload: {
            id: 'wamid_msg_001',
            status: 'read',
            timestamp: '1696673130',
          },
          processed: true,
          processedAt: new Date('2025-10-07T10:05:31Z'),
        },
      ],
    });

    console.log('✅ 3 eventos de webhook criados!');
  }

  // ==================== RESUMO ====================
  console.log('\n📊 RESUMO DO SEED:');
  console.log('==========================================');

  const totals = {
    templates: await prisma.messageTemplate.count(),
    campaigns: await prisma.campaign.count(),
    recipients: await prisma.campaignRecipient.count(),
    messages: await prisma.message.count(),
    webhooks: await prisma.webhookEvent.count(),
  };

  console.log(`📝 Templates criados: ${totals.templates}`);
  console.log(`🚀 Campanhas criadas: ${totals.campaigns}`);
  console.log(`👥 Destinatários criados: ${totals.recipients}`);
  console.log(`📨 Mensagens criadas: ${totals.messages}`);
  console.log(`🔔 Webhooks criados: ${totals.webhooks}`);
  console.log('==========================================');
  console.log('\n✅ Seed concluído com sucesso! 🎉\n');

  // Exemplos de IDs para testes
  console.log('🔑 IDs para testes:');
  console.log('==========================================');
  console.log(`Template Pedido: ${templatePedido.id}`);
  console.log(`Template Promoção: ${templatePromocao.id}`);
  console.log(`Campanha Black Friday: ${campanhaBlackFriday.id}`);
  console.log(`Campanha Carrinho: ${campanhaCarrinho.id}`);
  console.log('==========================================\n');
}

main()
  .catch((e) => {
    console.error('❌ Erro durante o seed:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
