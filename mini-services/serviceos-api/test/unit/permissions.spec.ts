import { ROLES, ROLE_PERMISSIONS, roleHasPermission } from '@serviceos/contracts';

describe('RBAC permission catalog (Tech Spec §15.4)', () => {
  it('covers every declared role', () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });

  it('default deny: unknown role has no permissions', () => {
    expect(roleHasPermission('intruder' as never, 'assets:read')).toBe(false);
  });

  it('technicians can execute work but never manage tenants, teams or contracts', () => {
    expect(roleHasPermission('technician', 'work_orders:execute')).toBe(true);
    expect(roleHasPermission('technician', 'work_orders:read')).toBe(true);
    expect(roleHasPermission('technician', 'work_orders:assign')).toBe(false);
    expect(roleHasPermission('technician', 'work_orders:review')).toBe(false);
    expect(roleHasPermission('technician', 'tenant:manage')).toBe(false);
    expect(roleHasPermission('technician', 'team:manage')).toBe(false);
    expect(roleHasPermission('technician', 'contracts:manage')).toBe(false);
    expect(roleHasPermission('technician', 'audit:read')).toBe(false);
  });

  it('coordinators dispatch but do not approve reports or manage contracts', () => {
    expect(roleHasPermission('coordinator', 'work_orders:assign')).toBe(true);
    expect(roleHasPermission('coordinator', 'work_orders:transition')).toBe(true);
    expect(roleHasPermission('coordinator', 'work_orders:review')).toBe(false);
    expect(roleHasPermission('coordinator', 'contracts:manage')).toBe(false);
    expect(roleHasPermission('coordinator', 'tenant:manage')).toBe(false);
  });

  it('auditors are strictly read-only', () => {
    const writable = ROLE_PERMISSIONS.auditor.filter((p) => p.endsWith(':write') || p.endsWith(':manage') || p.endsWith(':run') || p.endsWith(':publish'));
    expect(writable).toHaveLength(0);
    expect(roleHasPermission('auditor', 'audit:read')).toBe(true);
  });

  it('owners and admins hold the full operational set', () => {
    expect(roleHasPermission('owner', 'tenant:manage')).toBe(true);
    expect(roleHasPermission('admin', 'team:manage')).toBe(true);
    expect(roleHasPermission('owner', 'contracts:manage')).toBe(true);
  });
});
