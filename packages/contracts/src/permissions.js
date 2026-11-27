"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_PERMISSIONS = exports.PERMISSIONS = void 0;
exports.roleHasPermission = roleHasPermission;
exports.PERMISSIONS = [
    // tenants & team
    'tenant:manage',
    'team:read',
    'team:manage',
    'audit:read',
    // CRM
    'customers:read',
    'customers:write',
    'sites:read',
    'sites:write',
    'assets:read',
    'assets:write',
    'assets:qr:print',
    // service desk
    'requests:read',
    'requests:write',
    'requests:triage',
    'requests:convert',
    // work management
    'work_orders:read',
    'work_orders:write',
    'work_orders:assign',
    'work_orders:transition',
    'work_orders:review',
    'work_orders:execute', // technician field execution on ASSIGNED jobs only
    // checklists & contracts
    'checklists:read',
    'checklists:manage',
    'contracts:read',
    'contracts:manage',
    'maintenance:read',
    'maintenance:manage',
    // reports & files
    'reports:read',
    'reports:publish',
    'files:read',
    'files:write',
    // analytics & exports
    'analytics:read',
    'exports:run',
    // notifications (own only)
    'notifications:read',
];
exports.ROLE_PERMISSIONS = {
    owner: [
        'tenant:manage', 'team:read', 'team:manage', 'audit:read',
        'customers:read', 'customers:write', 'sites:read', 'sites:write',
        'assets:read', 'assets:write', 'assets:qr:print',
        'requests:read', 'requests:write', 'requests:triage', 'requests:convert',
        'work_orders:read', 'work_orders:write', 'work_orders:assign',
        'work_orders:transition', 'work_orders:review', 'work_orders:execute',
        'checklists:read', 'checklists:manage', 'contracts:read', 'contracts:manage',
        'maintenance:read', 'maintenance:manage', 'reports:read', 'reports:publish',
        'files:read', 'files:write', 'analytics:read', 'exports:run',
        'notifications:read',
    ],
    admin: [
        'tenant:manage', 'team:read', 'team:manage', 'audit:read',
        'customers:read', 'customers:write', 'sites:read', 'sites:write',
        'assets:read', 'assets:write', 'assets:qr:print',
        'requests:read', 'requests:write', 'requests:triage', 'requests:convert',
        'work_orders:read', 'work_orders:write', 'work_orders:assign',
        'work_orders:transition', 'work_orders:review', 'work_orders:execute',
        'checklists:read', 'checklists:manage', 'contracts:read', 'contracts:manage',
        'maintenance:read', 'maintenance:manage', 'reports:read', 'reports:publish',
        'files:read', 'files:write', 'analytics:read', 'exports:run',
        'notifications:read',
    ],
    service_manager: [
        'team:read', 'audit:read',
        'customers:read', 'customers:write', 'sites:read', 'sites:write',
        'assets:read', 'assets:write', 'assets:qr:print',
        'requests:read', 'requests:write', 'requests:triage', 'requests:convert',
        'work_orders:read', 'work_orders:write', 'work_orders:assign',
        'work_orders:transition', 'work_orders:review', 'work_orders:execute',
        'checklists:read', 'checklists:manage', 'contracts:read',
        'maintenance:read', 'maintenance:manage', 'reports:read', 'reports:publish',
        'files:read', 'files:write', 'analytics:read', 'exports:run',
        'notifications:read',
    ],
    coordinator: [
        'customers:read', 'customers:write', 'sites:read', 'sites:write',
        'assets:read', 'assets:write', 'assets:qr:print',
        'requests:read', 'requests:write', 'requests:triage', 'requests:convert',
        'work_orders:read', 'work_orders:write', 'work_orders:assign',
        'work_orders:transition', 'work_orders:execute',
        'checklists:read', 'contracts:read', 'maintenance:read',
        'reports:read', 'files:read', 'files:write', 'notifications:read',
    ],
    technician: [
        'assets:read',
        'work_orders:read', 'work_orders:execute',
        'checklists:read', 'requests:read',
        'files:read', 'files:write', 'reports:read', 'notifications:read',
    ],
    contract_admin: [
        'customers:read', 'sites:read', 'assets:read', 'assets:qr:print',
        'contracts:read', 'contracts:manage', 'maintenance:read', 'maintenance:manage',
        'requests:read', 'work_orders:read', 'checklists:read',
        'reports:read', 'reports:publish', 'files:read', 'files:write',
        'analytics:read', 'notifications:read',
    ],
    auditor: [
        'customers:read', 'sites:read', 'assets:read',
        'requests:read', 'work_orders:read', 'checklists:read',
        'contracts:read', 'maintenance:read', 'reports:read', 'files:read',
        'audit:read', 'analytics:read', 'notifications:read',
    ],
};
function roleHasPermission(role, permission) {
    return exports.ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
//# sourceMappingURL=permissions.js.map