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
    // req.id is set by nestjs-pino's genReqId (a validated/minted UUID); fall back only defensively.
    const correlationId = req.id ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL';
    let message: string | string[] = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = HttpStatus[status] ?? 'ERROR';
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        // Honour a caller-supplied semantic `code` (e.g. throw new BadRequestException({ code: 'MANIFEST_MISSING' }));
        // otherwise keep the HttpStatus name. Without this, object bodies with only a `code` key silently lose it.
        const rawCode = (body as { code?: unknown }).code;
        if (typeof rawCode === 'string') code = rawCode;
        const raw = (body as { message?: unknown }).message;
        message =
          typeof raw === 'string' || Array.isArray(raw)
            ? (raw as string | string[])
            : exception.message;
      } else {
        message = exception.message;
      }
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
