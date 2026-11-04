import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@serviceos/contracts';

export const REQUIRE_PERMISSIONS_KEY = 'requirePermissions';

/**
 * Declares the permission(s) required by a route. All listed permissions are
 * required. Enforced server-side by PermissionsGuard — UI hiding is cosmetic
 * only (Tech Spec §15.4).
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, permissions);
