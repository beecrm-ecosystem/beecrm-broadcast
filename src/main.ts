import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AllExceptionsFilter } from './broadcast/filters/http-exception.filter';

async function bootstrap() {
  // Define nível de log baseado no ambiente
  const logLevels: Array<'error' | 'warn' | 'log' | 'debug' | 'verbose'> =
    process.env.NODE_ENV === 'production'
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'];

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: logLevels,
  });
  const logger = new Logger('Bootstrap');

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

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  console.log(`🚀 Aplicação rodando em: http://localhost:${port}`);
  console.log(`📡 API Broadcast: http://localhost:${port}/api/broadcast`);
  console.log(`🎨 Painel Web: http://localhost:${port}/index.html`);
}

void bootstrap();
