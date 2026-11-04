import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';
import { Response } from 'express';

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Wraps successful controller results in the standard API envelope
 * (Tech Spec §10.4): { data, meta.requestId } — and { data, page, meta } for
 * paginated lists. Skipped for streamed/undecorated responses.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>('skipEnvelope', [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<{ requestId?: string }>();
    const response = context.switchToHttp().getResponse<Response>();
    const requestId = request?.requestId ?? '';

    return next.handle().pipe(
      map((result) => {
        if (skip || response.writableEnded || result === undefined) return result;
        if (
          result &&
          typeof result === 'object' &&
          Array.isArray((result as Paginated<unknown>).items)
        ) {
          const page = result as Paginated<unknown>;
          return {
            data: page.items,
            page: { nextCursor: page.nextCursor, hasMore: page.hasMore },
            meta: { requestId },
          };
        }
        return { data: result, meta: { requestId } };
      }),
    );
  }
}
