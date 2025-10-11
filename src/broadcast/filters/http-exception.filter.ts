import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: any = 'Internal server error';
    let errors: any = undefined;

    // Log detalhado do erro
    this.logger.error('========== ERRO CAPTURADO ==========');
    this.logger.error(`URL: ${request.method} ${request.url}`);
    this.logger.error(`Body: ${JSON.stringify(request.body, null, 2)}`);
    this.logger.error(`Query: ${JSON.stringify(request.query)}`);
    this.logger.error(`Params: ${JSON.stringify(request.params)}`);

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object') {
        message = (exceptionResponse as any).message || exception.message;
        errors = (exceptionResponse as any).errors;
      } else {
        message = exceptionResponse;
      }

      this.logger.error(`HttpException: ${status} - ${JSON.stringify(message)}`);
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(`Error: ${exception.name} - ${exception.message}`);
      this.logger.error(`Stack: ${exception.stack}`);
    } else {
      this.logger.error(`Unknown exception: ${JSON.stringify(exception)}`);
    }

    this.logger.error('========== FIM DO ERRO ==========');

    const errorResponse: any = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message,
    };

    if (errors) {
      errorResponse.errors = errors;
    }

    response.status(status).json(errorResponse);
  }
}
