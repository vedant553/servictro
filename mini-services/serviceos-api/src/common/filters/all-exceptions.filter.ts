import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { DomainError } from '../errors/domain.error';
import { childLogger } from '../logging/logger';

/**
 * Single error translation point (Tech Spec §9.4, §10.4): every error response
 * carries a stable `code`, a user-safe message and the requestId. Stack traces,
 * SQL and internal details are logged server-side only and never returned.
 */
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ requestId?: string; method?: string; url?: string }>();
    const requestId = request?.requestId ?? 'unknown';

    const { status, code, message, details } = this.translate(exception);
    const log = childLogger({ requestId, path: request?.url });
    if (status >= 500) {
      log.error({ err: exception }, 'Unhandled error');
    } else {
      log.warn({ code, status }, message);
    }

    response.status(status).json({
      error: { code, message, ...(details ? { details } : {}) },
      meta: { requestId },
    });
  }

  private translate(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: Array<{ field: string; reason: string }>;
  } {
    if (exception instanceof DomainError) {
      return { status: exception.status, code: exception.code, message: exception.message, details: exception.details };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return { status: 409, code: 'DUPLICATE', message: 'A record with the same unique value already exists' };
        case 'P2025':
          return { status: 404, code: 'NOT_FOUND', message: 'Record not found' };
        case 'P2034':
          return { status: 409, code: 'VERSION_CONFLICT', message: 'Concurrent update detected, retry' };
        default:
          return { status: 500, code: 'DATABASE_ERROR', message: 'Unexpected database error' };
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (status === HttpStatus.BAD_REQUEST && Array.isArray((body as { message?: unknown })?.message)) {
        const messages = ((body as { message: string[] }).message ?? []).map((m) => String(m));
        return {
          status,
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          details: messages.map((m) => ({ field: m.split(' ')[0], reason: m })),
        };
      }
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string })?.message ?? exception.message);
      const code =
        status === 401
          ? 'UNAUTHENTICATED'
          : status === 403
            ? 'FORBIDDEN'
            : status === 404
              ? 'NOT_FOUND'
              : status === 429
                ? 'RATE_LIMITED'
                : 'HTTP_ERROR';
      return { status, code, message: String(message) };
    }

    return { status: 500, code: 'INTERNAL_ERROR', message: 'Unexpected server error' };
  }
}
