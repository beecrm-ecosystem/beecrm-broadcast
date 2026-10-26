import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import {
  PROVIDER_WEBHOOK_PATH,
  providerWebhookBodyParser,
} from './broadcast/webhook/provider-webhook-body';
import { json, urlencoded } from 'express';
import { AllExceptionsFilter } from './broadcast/filters/http-exception.filter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  // Define nível de log baseado no ambiente
  const logLevels: Array<'error' | 'warn' | 'log' | 'debug' | 'verbose'> =
    process.env.NODE_ENV === 'production'
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'];

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: logLevels,
    // Desabilita o body-parser default (limite 100KB) para reconfigurar com limite maior abaixo.
    // Campanhas rotation enviam lotes de contatos com o template embutido por contato (metadata.templateOverride),
    // o que estoura 100KB e retorna 413 PayloadTooLargeError — lotes eram silenciosamente perdidos.
    bodyParser: false,
  });
  const logger = new Logger('Bootstrap');

  // Webhooks de provedor: corpo cru para conferir a assinatura da Meta (ver ProviderWebhookGuard).
  app.use(PROVIDER_WEBHOOK_PATH, providerWebhookBodyParser());

  // Body-parser com limite ampliado (default do Express e 100KB).
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));

  // Define prefixo global para as rotas da API
  app.setGlobalPrefix('api');

  // Aplica filtro global de exceções
  app.useGlobalFilters(new AllExceptionsFilter());

  // Habilita validação automática dos DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Adiciona logs detalhados de validação
      disableErrorMessages: false,
      validationError: {
        target: false,
        value: true,
      },
    }),
  );

  logger.log('ValidationPipe configurado com logs detalhados');

  // Habilita CORS
  app.enableCors();

  // Serve static files a partir da pasta raiz "static"
  app.useStaticAssets(join(process.cwd(), 'static'));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('BeeCRM Broadcast API')
    .setDescription('Documentação das rotas de broadcast e webhooks')
    .setVersion('1.0')
    .addTag('Broadcast')
    .addTag('Webhooks')
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  const swaggerPath = 'api/docs';
  SwaggerModule.setup(swaggerPath, app, swaggerDocument, {
    swaggerOptions: {
      persistAuthorization: true,
    },
    customSiteTitle: 'BeeCRM Broadcast - API Docs',
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  console.log(`🚀 Aplicação rodando em: http://localhost:${port}`);
  console.log(`📡 API Broadcast: http://localhost:${port}/api/broadcast`);
  console.log(`📘 Swagger UI: http://localhost:${port}/${swaggerPath}`);
  console.log(`🎨 Painel Web: http://localhost:${port}/index.html`);
}

void bootstrap();
