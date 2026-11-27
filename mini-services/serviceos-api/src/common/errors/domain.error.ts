/**
 * Typed domain error. Every business failure carries a stable machine-readable
 * `code` mapped to an HTTP status per the engineering spec §9.4:
 * 400 malformed · 401 unauthenticated · 403 forbidden · 404 inaccessible ·
 * 409 version/state conflict · 422 business validation · 429 rate limited.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 422,
    public readonly details?: Array<{ field: string; reason: string }>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const Errors = {
  unauthenticated: () => new DomainError('UNAUTHENTICATED', 'Authentication required', 401),
  invalidCredentials: () => new DomainError('INVALID_CREDENTIALS', 'Invalid email or password', 401),
  tokenExpired: () => new DomainError('TOKEN_EXPIRED', 'Session expired, please sign in again', 401),
  permissionDenied: (permission: string) =>
    new DomainError('PERMISSION_DENIED', `Your role does not permit this action (requires ${permission})`, 403),
  tenantSelectionRequired: () => new DomainError('TENANT_SELECTION_REQUIRED', 'Select an organization to continue', 403),
  noActiveTenant: () => new DomainError('NO_ACTIVE_TENANT', 'Your account has no active organization membership', 403),
  membershipInactive: () => new DomainError('MEMBERSHIP_INACTIVE', 'Your membership in this organization is not active', 403),
  notFound: (resource = 'Resource') => new DomainError('NOT_FOUND', `${resource} not found`, 404),
  versionConflict: () =>
    new DomainError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and retry.', 409),
  duplicate: (field: string) =>
    new DomainError('DUPLICATE', `A record with this ${field} already exists`, 409, [{ field, reason: 'duplicate' }]),
  stateConflict: (code: string, message: string) => new DomainError(code, message, 409),
  validationFailed: (details: Array<{ field: string; reason: string }>) =>
    new DomainError('VALIDATION_FAILED', 'Request validation failed', 400, details),
  rateLimited: () => new DomainError('RATE_LIMITED', 'Too many requests, slow down', 429),
} as const;
