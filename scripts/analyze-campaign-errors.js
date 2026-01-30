const axios = require('axios');

const campaignId = process.argv[2];
if (!campaignId) {
  console.error('Informe o ID da campanha');
  console.error('Uso: npm run analyze:errors -- <campaign-id>');
  process.exit(1);
}

const base = (process.env.BROADCAST_BASE_URL || 'https://homologbroadcast.beecrm.io').replace(/\/$/, '');
const limit = 200;

async function fetchAllRecipients(campaignId) {
  const allRecipients = [];
  let page = 1;
  let hasMore = true;

  console.log(`🔍 Buscando destinatários da campanha ${campaignId}...\n`);

  while (hasMore) {
    try {
      const url = `${base}/api/broadcast/${campaignId}/recipients?page=${page}&limit=${limit}`;
      const response = await axios.get(url);
      const { data, meta } = response.data;

      allRecipients.push(...data);
      console.log(`   Página ${page}/${meta.totalPages} - ${data.length} destinatários carregados`);

      hasMore = page < meta.totalPages;
      page++;
    } catch (error) {
      console.error(`❌ Erro ao buscar página ${page}:`, error.message);
      break;
    }
  }

  return allRecipients;
}

function analyzeErrors(recipients) {
  const analysis = {
    total: recipients.length,
    active: 0,
    inactive: 0,
    byStatus: {},
    failedWithDetails: [],
    failedWithoutDetails: [],
    errorTypes: {},
    errorCodes: {},
  };

  for (const recipient of recipients) {
    const status = recipient.status;
    analysis.byStatus[status] = (analysis.byStatus[status] || 0) + 1;

    if (recipient.isActive) {
      analysis.active++;
    } else {
      analysis.inactive++;
    }

    if (status === 'FAILED' || !recipient.isActive || recipient.messages?.some((m) => m.status === 'FAILED')) {
      const failedMessage = recipient.messages?.find((m) => m.status === 'FAILED') || recipient.messages?.[0];

      const errorInfo = {
        recipientId: recipient.id,
        phone: recipient.phoneNumber,
        name: recipient.name,
        status: recipient.status,
        messageId: failedMessage?.id,
        errorCode: failedMessage?.errorCode,
        errorMessage: failedMessage?.errorMessage,
        errorDetails: failedMessage?.errorDetails,
        failedAt: failedMessage?.failedAt || recipient.metadata?.failedAt,
      };

      if (failedMessage?.errorCode || failedMessage?.errorMessage) {
        analysis.failedWithDetails.push(errorInfo);

        // Agrupa por código de erro
        const code = failedMessage.errorCode || 'UNKNOWN';
        analysis.errorCodes[code] = (analysis.errorCodes[code] || 0) + 1;

        // Agrupa por tipo de mensagem de erro
        const msg = failedMessage.errorMessage || 'Sem mensagem';
        analysis.errorTypes[msg] = (analysis.errorTypes[msg] || 0) + 1;
      } else {
        analysis.failedWithoutDetails.push(errorInfo);
      }
    }
  }

  return analysis;
}

function printReport(analysis) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 RELATÓRIO DE ANÁLISE DE ERROS');
  console.log('='.repeat(80));

  console.log(`\n📈 Resumo Geral:`);
  console.log(`   Total de destinatários: ${analysis.total}`);
  console.log(`   Ativos (isActive=true): ${analysis.active}`);
  console.log(`   Inativos (isActive=false): ${analysis.inactive}`);
  console.log(`\n📊 Status dos Destinatários:`);
  Object.entries(analysis.byStatus)
    .sort(([, a], [, b]) => b - a)
    .forEach(([status, count]) => {
      const percentage = ((count / analysis.total) * 100).toFixed(2);
      console.log(`   ${status}: ${count} (${percentage}%)`);
    });

  console.log(`\n❌ Falhas Detectadas:`);
  console.log(`   Com detalhes de erro: ${analysis.failedWithDetails.length}`);
  console.log(`   Sem detalhes de erro: ${analysis.failedWithoutDetails.length}`);
  console.log(`   Total de falhas: ${analysis.failedWithDetails.length + analysis.failedWithoutDetails.length}`);

  if (Object.keys(analysis.errorCodes).length > 0) {
    console.log(`\n🔢 Códigos de Erro Encontrados:`);
    Object.entries(analysis.errorCodes)
      .sort(([, a], [, b]) => b - a)
      .forEach(([code, count]) => {
        console.log(`   ${code}: ${count} ocorrências`);
      });
  }

  if (Object.keys(analysis.errorTypes).length > 0) {
    console.log(`\n💬 Mensagens de Erro Mais Comuns:`);
    Object.entries(analysis.errorTypes)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .forEach(([msg, count]) => {
        const truncated = msg.length > 80 ? msg.substring(0, 77) + '...' : msg;
        console.log(`   [${count}x] ${truncated}`);
      });
  }

  if (analysis.failedWithDetails.length > 0) {
    console.log(`\n📋 Exemplos de Falhas com Detalhes (primeiras 5):`);
    analysis.failedWithDetails.slice(0, 5).forEach((error, idx) => {
      console.log(`\n   ${idx + 1}. ${error.name || 'Sem nome'} (${error.phone})`);
      console.log(`      Código: ${error.errorCode || 'N/A'}`);
      console.log(`      Mensagem: ${error.errorMessage || 'N/A'}`);
      if (error.errorDetails) {
        console.log(`      Detalhes: ${JSON.stringify(error.errorDetails).substring(0, 100)}`);
      }
    });
  }

  if (analysis.failedWithoutDetails.length > 0) {
    console.log(`\n⚠️  Falhas SEM Detalhes de Erro (${analysis.failedWithoutDetails.length}):`);
    console.log(`   Estes destinatários falharam mas não possuem errorCode/errorMessage registrados.`);
    analysis.failedWithoutDetails.slice(0, 5).forEach((error, idx) => {
      console.log(`   ${idx + 1}. ${error.name || 'Sem nome'} (${error.phone}) - Status: ${error.status}`);
    });
    if (analysis.failedWithoutDetails.length > 5) {
      console.log(`   ... e mais ${analysis.failedWithoutDetails.length - 5} destinatários`);
    }
  }

  console.log('\n' + '='.repeat(80));
}

async function main() {
  try {
    const recipients = await fetchAllRecipients(campaignId);

    if (recipients.length === 0) {
      console.log('⚠️  Nenhum destinatário encontrado.');
      return;
    }

    const analysis = analyzeErrors(recipients);
    printReport(analysis);

    // Salva o relatório detalhado em JSON
    const reportFile = `campaign-${campaignId}-error-analysis.json`;
    const fs = require('fs');
    fs.writeFileSync(
      reportFile,
      JSON.stringify(
        {
          campaignId,
          analyzedAt: new Date().toISOString(),
          summary: {
            total: analysis.total,
            active: analysis.active,
            inactive: analysis.inactive,
            byStatus: analysis.byStatus,
            failedWithDetails: analysis.failedWithDetails.length,
            failedWithoutDetails: analysis.failedWithoutDetails.length,
          },
          errorCodes: analysis.errorCodes,
          errorTypes: analysis.errorTypes,
          failedRecipients: [...analysis.failedWithDetails, ...analysis.failedWithoutDetails],
        },
        null,
        2
      )
    );

    console.log(`\n💾 Relatório detalhado salvo em: ${reportFile}`);
  } catch (error) {
    console.error('❌ Erro ao analisar campanha:', error.message);
    process.exit(1);
  }
}

main();
