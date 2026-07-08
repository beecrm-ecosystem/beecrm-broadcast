/**
 * Exporta a especificação OpenAPI do BeeCRM Broadcast para um arquivo estático
 * (openapi.json na raiz do repo), SEM subir o servidor HTTP.
 *
 * Uso:
 *   npm run export:openapi
 *
 * Objetivo (Fase 0 do saneamento de contrato): manter o contrato REST legível
 * por máquina versionado no repo. O diff do openapi.json em PRs sinaliza
 * breaking changes na borda consumida pelo CRM (BroadcastClient).
 *
 * NOTA: instancia o AppModule, que inicializa o BullModule (BullMQ/ioredis) no
 * boot. Portanto requer as mesmas envs de Redis do app
 * (REDIS_HOST / REDIS_PORT / REDIS_PASSWORD). Rode em um ambiente com Redis
 * acessível (ou aponte REDIS_HOST para um Redis local).
 */
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';

async function main() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
    abortOnError: false,
  });
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('BeeCRM Broadcast API')
    .setDescription('Documentação das rotas de broadcast e webhooks')
    .setVersion('1.0')
    .addTag('Broadcast')
    .addTag('Webhooks')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  const outPath = join(process.cwd(), 'openapi.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2));
  // eslint-disable-next-line no-console
  console.log(`OpenAPI exportado para ${outPath}`);

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Falha ao exportar OpenAPI:', err);
  process.exit(1);
});
