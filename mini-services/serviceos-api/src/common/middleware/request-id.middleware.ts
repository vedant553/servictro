import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { childLogger } from '../logging/logger';

/**
 * Assigns a request id (honours inbound X-Request-Id), echoes it on the
 * response and emits one structured access-log line per request.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.headers['x-request-id'];
    const requestId = typeof inbound === 'string' && inbound.length <= 64 ? inbound : randomUUID();
    (req as Request & { requestId: string }).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const start = Date.now();
    res.on('finish', () => {
      const ctx = (req as Request & { tenantContext?: { tenantId?: string } }).tenantContext;
      childLogger({
        requestId,
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - start,
        tenantId: ctx?.tenantId,
      }).info('http_request');
    });
    next();
  }
}
