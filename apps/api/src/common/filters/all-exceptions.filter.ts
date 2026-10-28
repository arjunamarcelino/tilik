import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string | string[];
    correlationId: string;
    timestamp: string;
  };
}

/**
 * Single error envelope for the whole API. HttpExceptions (incl. ValidationPipe's BadRequest) keep their
 * status and safe message; anything else is mapped to a generic 500 so no Prisma/driver/stack internals
 * leak to the client (OWASP ASVS V16.5). The correlationId ties the client response to the server log.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const correlationId =
      (req.headers['x-correlation-id'] as string | undefined) ?? req.id ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL';
    let message: string | string[] = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = HttpStatus[status] ?? 'ERROR';
      const body = exception.getResponse();
      message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ?? exception.message);
    } else {
      // Unknown/unhandled: log the real detail server-side (keyed by correlationId), return nothing to the client.
      this.logger.error(
        { correlationId, err: exception instanceof Error ? exception.message : String(exception) },
        'Unhandled exception',
      );
    }

    const envelope: ErrorEnvelope = {
      error: { code, message, correlationId, timestamp: new Date().toISOString() },
    };
    res.status(status).json(envelope);
  }
}
