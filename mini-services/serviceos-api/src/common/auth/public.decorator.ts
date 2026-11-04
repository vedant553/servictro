import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route as reachable without authentication (login, health…). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Marks a route whose response must not be wrapped in the API envelope. */
export const SkipEnvelope = () => SetMetadata('skipEnvelope', true);
