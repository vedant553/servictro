import '../src/common/config/load-env-file';
import { PrismaClient, Prisma } from '@prisma/client';
import { hashPassword } from '../src/common/auth/password';

/**
 * Development seed (ADR-015): two FICTIONAL tenants with a realistic
 * electrical-OEM dataset so every screen and metric renders with meaningful
 * data and cross-tenant isolation can be demonstrated. No real company data,
 * names or contacts from the Customer Validation Kit enter the codebase
 * (data-hygiene rule).
 *
 * Demo credentials (DEV ONLY — documented in docs/DEVELOPMENT_SETUP.md):
 *   owner@gridnova.example    / DemoOwner#2026   (GridNova Systems — full demo)
 *   tech@gridnova.example     / DemoTech#2026    (GridNova technician)
 *   coord@gridnova.example    / DemoCoord#2026   (GridNova coordinator)
 *   owner@voltline.example  / DemoOwner#2026   (Voltline Power — tenant B)
 */
// Seeding is a privileged bootstrap operation: run with the migration role
// (serviceos_migrate, BYPASSRLS — FORCE ROW LEVEL SECURITY subjects even the
// table owner, so bootstrap needs an explicit bypass role). Runtime
// application access always uses the RLS-subject role (serviceos_app).
const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_MIGRATE_URL,
});

async function main(): Promise<void> {
  const existing = await prisma.tenant.count();
  if (existing > 0) {
    console.log(`[seed] database already has ${existing} tenant(s) — skipping`);
    return;
  }
  console.log('[seed] creating demo tenants…');

  // Each tenant seeds in its own interactive transaction: a failure anywhere
  // rolls the whole tenant back instead of leaving a half-seeded database
  // (which the skip-guard would then silently preserve).
  await prisma.$transaction(async (tx) => seedTenantGridNova(tx));
  await prisma.$transaction(async (tx) => seedTenantVoltline(tx));

  console.log('[seed] done');
}

async function seedTenantGridNova(db: Prisma.TransactionClient | PrismaClient = prisma): Promise<void> {
  const tenant = await db.tenant.create({
    data: {
      slug: 'gridnova-systems',
      name: 'GridNova Systems Pvt. Ltd.',
      legalName: 'GridNova Systems Private Limited',
      timezone: 'Asia/Kolkata',
      settings: {
        slaResponseMinutes: { low: 480, medium: 240, high: 120, critical: 60 },
        slaResolutionMinutes: { low: 4320, medium: 2880, high: 1440, critical: 480 },
      } as Prisma.InputJsonValue,
    },
  });
  const tenantId = tenant.id;

  const users = await Promise.all([
    db.user.create({
      data: {
        email: 'owner@gridnova.example',
        displayName: 'Priya Sharma',
        passwordHash: await hashPassword('DemoOwner#2026'),
        memberships: { create: { tenantId, role: 'owner', status: 'active', title: 'Managing Director' } },
      },
    }),
    db.user.create({
      data: {
        email: 'coord@gridnova.example',
        displayName: 'Rahul Mehta',
        passwordHash: await hashPassword('DemoCoord#2026'),
        memberships: { create: { tenantId, role: 'coordinator', status: 'active', title: 'Service Coordinator' } },
      },
    }),
    db.user.create({
      data: {
        email: 'tech@gridnova.example',
        displayName: 'Sunil Kadam',
        passwordHash: await hashPassword('DemoTech#2026'),
        memberships: {
          create: { tenantId, role: 'technician', status: 'active', title: 'Senior Service Engineer', skills: ['LT panels', 'ACB', 'HT switchgear', 'VCB'] },
        },
      },
    }),
    db.user.create({
      data: {
        email: 'manager@gridnova.example',
        displayName: 'Meera Iyer',
        passwordHash: await hashPassword('DemoOwner#2026'),
        memberships: { create: { tenantId, role: 'service_manager', status: 'active', title: 'Head of Service' } },
      },
    }),
  ]);
  const [owner, coordinator, technician, manager] = users;

  // Checklist templates (LT panel + HT switchgear PM procedures)
  const ltTemplate = await db.checklistTemplate.create({
    data: {
      tenantId,
      templateKey: 'lt_panel_pm',
      name: 'LT Panel — Quarterly Preventive Maintenance',
      assetFamily: 'lt_panel',
      activeVersion: 1,
    },
  });
  await db.checklistTemplateVersion.create({
    data: {
      tenantId,
      templateId: ltTemplate.id,
      version: 1,
      approvedById: manager.id,
      approvedAt: new Date(),
      definition: {
        schemaVersion: 1,
        items: [
          { key: 'visual_inspection', label: 'Visual inspection of enclosure, gaskets, door interlocks', type: 'check', required: true },
          { key: 'busbar_temp_c', label: 'Busbar temperature at full load', type: 'measurement', required: true, unit: '°C', maxValue: 90 },
          { key: 'insulation_resistance_mohm', label: 'Insulation resistance (IR) test', type: 'measurement', required: true, unit: 'MΩ', minValue: 1 },
          { key: 'breaker_contacts', label: 'Check breaker contact wear / condition', type: 'check', required: true },
          { key: 'relay_settings', label: 'Verify relay trip settings against approved schedule', type: 'check', required: true },
          { key: 'earthing_continuity', label: 'Earthing continuity verification', type: 'check', required: true },
          { key: 'tightening_torque', label: 'Re-torque incoming/outgoing terminations (sample)', type: 'check', required: false },
          { key: 'panel_cleaning', label: 'Clean panel interior / replace desiccant if fitted', type: 'check', required: false },
        ],
      } as Prisma.InputJsonValue,
    },
  });

  const htTemplate = await db.checklistTemplate.create({
    data: {
      tenantId,
      templateKey: 'ht_vcb_pm',
      name: 'HT Switchgear (VCB) — Half-Yearly Maintenance',
      assetFamily: 'ht_switchgear',
      activeVersion: 1,
    },
  });
  await db.checklistTemplateVersion.create({
    data: {
      tenantId,
      templateId: htTemplate.id,
      version: 1,
      approvedById: manager.id,
      approvedAt: new Date(),
      definition: {
        schemaVersion: 1,
        items: [
          { key: 'vcb_contact_resistance_mohm', label: 'VCB pole contact resistance (micro-ohm)', type: 'measurement', required: true, unit: 'µΩ', maxValue: 80 },
          { key: 'insulation_resistance_mohm', label: 'Insulation resistance test', type: 'measurement', required: true, unit: 'MΩ', minValue: 100 },
          { key: 'sf6_or_vacuum_integrity', label: 'Interrupter integrity check', type: 'check', required: true },
          { key: 'mechanism_operation', label: 'Spring-charged mechanism operation count / condition', type: 'check', required: true },
          { key: 'protection_relay_test', label: 'Secondary injection test of protection relay', type: 'check', required: true },
          { key: 'ct_pt_wiring', label: 'CT/PT wiring & terminal tightness', type: 'check', required: false },
        ],
      } as Prisma.InputJsonValue,
    },
  });

  // Customer + contacts + sites + assets
  const shakti = await db.customerAccount.create({
    data: {
      tenantId,
      accountCode: 'CUS-000001',
      legalName: 'Shakti Cement Industries Ltd.',
      segment: 'Cement',
      billingAddress: { line1: 'Plot 14, MIDC Bhosari', city: 'Pune', state: 'Maharashtra', postalCode: '411026', country: 'IN' },
      contacts: {
        create: [
          { name: 'Anil Deshmukh', role: 'Maintenance Manager', email: 'anil.deshmukh@shakti-cement.example', phone: '+91 98200 11223', isPrimary: true },
          { name: 'Kavita Joshi', role: 'Electrical Engineer', email: 'kavita.joshi@shakti-cement.example', phone: '+91 98200 44556' },
        ],
      },
    },
  });
  const bhosariSite = await db.site.create({
    data: {
      tenantId,
      customerId: shakti.id,
      siteCode: 'SHAKTI-PUNE-01',
      name: 'Bhosari Plant — Panel Room 2',
      address: { line1: 'Plot 14, MIDC Bhosari', city: 'Pune', state: 'Maharashtra', postalCode: '411026', country: 'IN' },
      latitude: new Prisma.Decimal('19.0035'),
      longitude: new Prisma.Decimal('73.7873'),
      accessInstructions: 'Enter via Gate 3. PPE mandatory. Escort from maintenance office required beyond crusher area.',
    },
  });
  const asset1 = await db.asset.create({
    data: {
      tenantId,
      siteId: bhosariSite.id,
      assetCode: 'AST-000101',
      serialNumber: 'AUR-LT-2024-0789',
      assetFamily: 'lt_panel',
      manufacturer: 'GridNova Systems',
      model: 'ASG-415-LT-12F',
      commissioningDate: new Date('2024-06-15'),
      specification: {
        schemaVersion: 1,
        electrical: { ratedVoltageV: 415, phaseCount: 3, ratedFrequencyHz: 50, ratedCurrentA: 1600, shortCircuitWithstandKa: 50 },
        construction: { ipRating: 'IP54', busbarMaterial: 'copper', incomerType: 'ACB', outgoingFeederCount: 12 },
        documentation: { drawingRevision: 'C' },
      } as Prisma.InputJsonValue,
    },
  });
  const asset2 = await db.asset.create({
    data: {
      tenantId,
      siteId: bhosariSite.id,
      assetCode: 'AST-000102',
      serialNumber: 'AUR-HT-2023-0212',
      assetFamily: 'ht_switchgear',
      manufacturer: 'GridNova Systems',
      model: 'ASG-11KV-VCB-01',
      commissioningDate: new Date('2023-11-02'),
      specification: {
        schemaVersion: 1,
        electrical: { voltageClassKv: 11, ratedCurrentA: 630, breakingCapacityKa: 25, insulationMedium: 'vacuum' },
        construction: { ipRating: 'IP54', incomerType: 'VCB' },
      } as Prisma.InputJsonValue,
    },
  });

  // Contracts: warranty on asset1, AMC covering both
  const warranty = await db.serviceContract.create({
    data: {
      tenantId,
      customerId: shakti.id,
      contractNo: 'CTR-2026-000001',
      contractType: 'warranty',
      status: 'active',
      startDate: new Date('2024-06-15'),
      endDate: new Date('2027-06-14'),
      currencyCode: 'INR',
      responseTargetMinutes: 480,
      resolutionTargetMinutes: 72 * 60,
      assets: { create: [{ assetId: asset1.id, coverageType: 'full' }] },
    },
  });
  const amc = await db.serviceContract.create({
    data: {
      tenantId,
      customerId: shakti.id,
      contractNo: 'CTR-2026-000002',
      contractType: 'amc',
      status: 'active',
      startDate: new Date('2026-04-01'),
      endDate: new Date(Date.now() + 55 * 86_400_000), // ~55 days left → renewal due_soon
      currencyCode: 'INR',
      amountMinor: BigInt(1_800_000),
      responseTargetMinutes: 240,
      resolutionTargetMinutes: 48 * 60,
      includedVisitsPerYear: 4,
      terms: { inclusions: '4 quarterly PM visits, breakdown attendance within SLA', exclusions: 'Physical damage, misuse, third-party intervention' } as Prisma.InputJsonValue,
      assets: {
        create: [
          { assetId: asset1.id, coverageType: 'full', includedVisits: 4 },
          { assetId: asset2.id, coverageType: 'full', includedVisits: 2 },
        ],
      },
    },
  });

  // Maintenance plan on the LT panel (quarterly PM under the AMC)
  const plan = await db.maintenancePlan.create({
    data: {
      tenantId,
      contractId: amc.id,
      planCode: 'PM-SHAKTI-Q',
      name: 'Shakti Pune — quarterly LT panel PM',
      assetFamily: 'lt_panel',
      recurrence: { frequency: 'quarter', interval: 1 } as Prisma.InputJsonValue,
      startDate: new Date('2026-04-01'),
      horizonDays: 120,
      leadDays: 14,
      checklistTemplateId: ltTemplate.id,
      status: 'active',
    },
  });
  await db.maintenancePlanAsset.create({ data: { tenantId, planId: plan.id, assetId: asset1.id } });

  // A second customer without coverage (tests the entitlement warning path)
  const nova = await db.customerAccount.create({
    data: {
      tenantId,
      accountCode: 'CUS-000002',
      legalName: 'Nova Textiles Pvt. Ltd.',
      segment: 'Textiles',
      billingAddress: { line1: 'Kharadi', city: 'Pune', state: 'Maharashtra', postalCode: '411014', country: 'IN' },
      contacts: { create: [{ name: 'Farhan Sheikh', role: 'Plant Engineer', isPrimary: true }] },
    },
  });
  const novaSite = await db.site.create({
    data: {
      tenantId,
      customerId: nova.id,
      siteCode: 'NOVA-PUNE-01',
      name: 'Kharadi Weaving Unit',
      address: { line1: 'Survey 210, Kharadi', city: 'Pune', state: 'Maharashtra', postalCode: '411014', country: 'IN' },
    },
  });
  const asset3 = await db.asset.create({
    data: {
      tenantId,
      siteId: novaSite.id,
      assetCode: 'AST-000103',
      serialNumber: 'AUR-LT-2025-0455',
      assetFamily: 'lt_panel',
      manufacturer: 'GridNova Systems',
      model: 'ASG-415-LT-8F',
      commissioningDate: new Date('2025-02-10'),
      specification: {
        schemaVersion: 1,
        electrical: { ratedVoltageV: 415, phaseCount: 3, ratedCurrentA: 800, shortCircuitWithstandKa: 35 },
        construction: { ipRating: 'IP43', busbarMaterial: 'copper', incomerType: 'ACB', outgoingFeederCount: 8 },
      } as Prisma.InputJsonValue,
    },
  });

  // Service request (open, linked to asset1) awaiting triage
  await db.serviceRequest.create({
    data: {
      tenantId,
      requestNo: 'SR-2026-000001',
      customerId: shakti.id,
      siteId: bhosariSite.id,
      assetId: asset1.id,
      source: 'phone',
      category: 'tripping',
      subject: 'LT panel feeder 3 tripping repeatedly',
      description: 'Customer reports the feeder 3 breaker trips almost daily since last week; lights flicker just before the trip. Load around 60% of rated.',
      severity: 'high',
      status: 'new',
      createdById: coordinator.id,
      createdAt: new Date(Date.now() - 1 * 86_400_000),
    },
  });

  // A request already converted → work order in progress, assigned to technician
  const request2 = await db.serviceRequest.create({
    data: {
      tenantId,
      requestNo: 'SR-2026-000002',
      customerId: shakti.id,
      siteId: bhosariSite.id,
      assetId: asset2.id,
      source: 'email',
      category: 'abnormal_sound',
      subject: 'Clicking sound from HT VCB panel during switching',
      description: 'Operations noticed unusual clicking from the VCB mechanism while racking in. Requesting inspection before next shutdown window.',
      severity: 'medium',
      status: 'accepted',
      createdById: coordinator.id,
      acceptedAt: new Date(Date.now() - 2 * 86_400_000),
      triagedAt: new Date(Date.now() - 3 * 86_400_000),
      createdAt: new Date(Date.now() - 3 * 86_400_000),
    },
  });
  const wo1 = await db.workOrder.create({
    data: {
      tenantId,
      workOrderNo: 'WO-2026-000001',
      requestId: request2.id,
      customerId: shakti.id,
      siteId: bhosariSite.id,
      assetId: asset2.id,
      title: 'HT VCB mechanism inspection — clicking sound',
      description: 'Inspect VCB spring-charged mechanism, pole contact resistance, interrupter integrity. Report findings to customer maintenance manager.',
      type: 'breakdown',
      status: 'scheduled',
      priority: 'high',
      scheduledStartAt: new Date(Date.now() + 2 * 86_400_000),
      scheduledEndAt: new Date(Date.now() + 2 * 86_400_000 + 4 * 3_600_000),
      responseDueAt: new Date(Date.now() + 4 * 3_600_000),
      resolutionDueAt: new Date(Date.now() + 48 * 3_600_000),
      slaPolicy: { basis: 'contract', severity: 'medium', responseMinutes: 240, resolutionMinutes: 2880, contractNo: amc.contractNo } as Prisma.InputJsonValue,
      checklistTemplateVersionId: (await db.checklistTemplateVersion.findFirst({ where: { templateId: htTemplate.id } }))!.id,
      requiredSkills: ['HT switchgear', 'VCB'],
      createdById: coordinator.id,
      events: { create: { eventType: 'created', toStatus: 'draft', actorUserId: coordinator.id } },
    },
  });
  await db.workOrderAssignment.create({
    data: { tenantId, workOrderId: wo1.id, userId: technician.id, assignmentRole: 'technician', status: 'offered' },
  });

  // A completed + closed historical work order so analytics show real numbers
  const request3 = await db.serviceRequest.create({
    data: {
      tenantId,
      requestNo: 'SR-2026-000003',
      customerId: shakti.id,
      siteId: bhosariSite.id,
      assetId: asset1.id,
      source: 'whatsapp',
      category: 'overheating',
      subject: 'Busbar chamber running warm',
      description: 'Thermal gun reading 78°C near the incomer busbar at ~70% load.',
      severity: 'medium',
      status: 'converted',
      createdById: coordinator.id,
      triagedAt: new Date(Date.now() - 20 * 86_400_000),
      acceptedAt: new Date(Date.now() - 20 * 86_400_000 + 3_600_000),
      convertedAt: new Date(Date.now() - 19 * 86_400_000),
      createdAt: new Date(Date.now() - 21 * 86_400_000),
    },
  });
  const wo2 = await db.workOrder.create({
    data: {
      tenantId,
      workOrderNo: 'WO-2026-000002',
      requestId: request3.id,
      customerId: shakti.id,
      siteId: bhosariSite.id,
      assetId: asset1.id,
      title: 'Busbar overheating — inspection and rectification',
      description: 'Check torque, contact condition and load balance on incomer busbar.',
      type: 'breakdown',
      status: 'closed',
      priority: 'normal',
      scheduledStartAt: new Date(Date.now() - 18 * 86_400_000),
      scheduledEndAt: new Date(Date.now() - 18 * 86_400_000 + 4 * 3_600_000),
      responseDueAt: new Date(Date.now() - 19 * 86_400_000 + 4 * 3_600_000),
      resolutionDueAt: new Date(Date.now() - 19 * 86_400_000 + 48 * 3_600_000),
      slaPolicy: { basis: 'contract', severity: 'medium', responseMinutes: 240, resolutionMinutes: 2880, contractNo: amc.contractNo } as Prisma.InputJsonValue,
      checklistTemplateVersionId: (await db.checklistTemplateVersion.findFirst({ where: { templateId: ltTemplate.id } }))!.id,
      completionSummary: 'Found loose lug on incomer phase B; re-terminated, torqued to spec and verified temperature drop to 52°C at similar load. Recommended thermographic check at next PM.',
      completedAt: new Date(Date.now() - 17 * 86_400_000 - 6 * 3_600_000),
      closedAt: new Date(Date.now() - 16 * 86_400_000),
      createdAt: new Date(Date.now() - 19 * 86_400_000),
      createdById: coordinator.id,
      events: { create: { eventType: 'created', toStatus: 'draft', actorUserId: coordinator.id } },
    },
  });
  await db.workOrderAssignment.create({
    data: { tenantId, workOrderId: wo2.id, userId: technician.id, assignmentRole: 'technician', status: 'completed', acceptedAt: new Date(Date.now() - 18 * 86_400_000), completedAt: new Date(Date.now() - 17 * 86_400_000) },
  });
  const ltVersion = (await db.checklistTemplateVersion.findFirst({ where: { templateId: ltTemplate.id } }))!;
  const checklistData = [
    { tenantId, workOrderId: wo2.id, templateVersionId: ltVersion.id, itemKey: 'visual_inspection', outcome: 'pass' as const, performedById: technician.id },
    { tenantId, workOrderId: wo2.id, templateVersionId: ltVersion.id, itemKey: 'busbar_temp_c', outcome: 'pass' as const, valueNumeric: new Prisma.Decimal('52.4'), unit: '°C', performedById: technician.id },
    { tenantId, workOrderId: wo2.id, templateVersionId: ltVersion.id, itemKey: 'insulation_resistance_mohm', outcome: 'pass' as const, valueNumeric: new Prisma.Decimal('620'), unit: 'MΩ', performedById: technician.id },
    { tenantId, workOrderId: wo2.id, templateVersionId: ltVersion.id, itemKey: 'breaker_contacts', outcome: 'pass' as const, performedById: technician.id },
    { tenantId, workOrderId: wo2.id, templateVersionId: ltVersion.id, itemKey: 'relay_settings', outcome: 'pass' as const, performedById: technician.id },
    { tenantId, workOrderId: wo2.id, templateVersionId: ltVersion.id, itemKey: 'earthing_continuity', outcome: 'pass' as const, performedById: technician.id },
  ];
  await db.checklistResult.createMany({ data: checklistData });
  await db.serviceObservation.create({
    data: { tenantId, workOrderId: wo2.id, kind: 'finding', text: 'Phase B incomer lug discoloured and below torque spec; lug replaced from spares.', recordedById: technician.id },
  });
  await db.serviceObservation.create({
    data: { tenantId, workOrderId: wo2.id, kind: 'action', text: 'Re-terminated lug, torqued to 45 Nm, thermal image re-taken after 2h load.', recordedById: technician.id },
  });
  await db.partUsage.create({
    data: { tenantId, workOrderId: wo2.id, partCode: 'LUG-DT-150', description: 'Copper lug D-type 150mm²', quantity: new Prisma.Decimal('1'), unit: 'nos', recordedById: technician.id },
  });
  const report2 = await db.serviceReport.create({
    data: {
      tenantId,
      workOrderId: wo2.id,
      reportVersion: 1,
      status: 'published',
      summary: wo2.completionSummary,
      approvedById: manager.id,
      approvedAt: new Date(Date.now() - 16 * 86_400_000),
      publishedAt: new Date(Date.now() - 16 * 86_400_000),
      acknowledgedByName: 'Anil Deshmukh',
      acknowledgedByRole: 'Maintenance Manager',
      acknowledgedAt: new Date(Date.now() - 16 * 86_400_000),
      acknowledgementMethod: 'name_confirmation',
    },
  });
  await db.workOrderEvent.createMany({
    data: [
      { tenantId, workOrderId: wo2.id, eventType: 'status_changed', fromStatus: 'scheduled', toStatus: 'in_progress', actorUserId: technician.id },
      { tenantId, workOrderId: wo2.id, eventType: 'status_changed', fromStatus: 'in_progress', toStatus: 'pending_review', actorUserId: technician.id },
      { tenantId, workOrderId: wo2.id, eventType: 'status_changed', fromStatus: 'pending_review', toStatus: 'completed', actorUserId: manager.id },
      { tenantId, workOrderId: wo2.id, eventType: 'status_changed', fromStatus: 'completed', toStatus: 'closed', actorUserId: coordinator.id },
      { tenantId, workOrderId: wo2.id, eventType: 'report_published', actorUserId: manager.id },
    ],
  });

  // A planned visit in the near future for the PM queue
  await db.plannedVisit.create({
    data: {
      tenantId,
      planId: plan.id,
      assetId: asset1.id,
      dueAt: new Date(Date.now() + 21 * 86_400_000),
      generationKey: `${plan.id}:${asset1.id}:${new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10)}`,
      status: 'planned',
    },
  });

  // Seed notifications + audit trail entries for realism
  await db.notification.create({
    data: {
      tenantId,
      userId: coordinator.id,
      category: 'request_created',
      title: 'New request SR-2026-000001',
      body: 'LT panel feeder 3 tripping repeatedly — Shakti Cement Industries Ltd. (high)',
      entityType: 'service_request',
      entityId: request2.id,
    },
  });
  await db.notification.create({
    data: {
      tenantId,
      userId: technician.id,
      category: 'work_order_assigned',
      title: 'Assigned: WO-2026-000001',
      body: 'HT VCB mechanism inspection — high priority. Check My Jobs for the full job pack.',
      entityType: 'work_order',
      entityId: wo1.id,
    },
  });
  await db.auditEvent.createMany({
    data: [
      { tenantId, actorUserId: owner.id, action: 'tenant.created', resourceType: 'tenant', resourceId: tenantId },
      { tenantId, actorUserId: coordinator.id, action: 'customer.created', resourceType: 'customer', resourceId: shakti.id },
      { tenantId, actorUserId: coordinator.id, action: 'asset.registered', resourceType: 'asset', resourceId: asset1.id },
      { tenantId, actorUserId: coordinator.id, action: 'asset.registered', resourceType: 'asset', resourceId: asset2.id },
      { tenantId, actorUserId: manager.id, action: 'contract.created', resourceType: 'contract', resourceId: amc.id },
      { tenantId, actorUserId: coordinator.id, action: 'work_order.created', resourceType: 'work_order', resourceId: wo2.id },
      { tenantId, actorUserId: manager.id, action: 'report.published', resourceType: 'service_report', resourceId: report2.id },
    ],
  });

  // Number-sequence counters must match the explicitly-numbered records above,
  // otherwise the next allocation would collide (UNIQUE (tenant_id, key) +
  // unique request_no/work_order_no/…).
  const year = new Date().getUTCFullYear();
  await db.numberSequence.createMany({
    data: [
      { tenantId, key: `service_request:${year}`, prefix: 'SR', nextValue: 4 },
      { tenantId, key: `work_order:${year}`, prefix: 'WO', nextValue: 3 },
      { tenantId, key: `contract:${year}`, prefix: 'CTR', nextValue: 3 },
      { tenantId, key: 'customer', prefix: 'CUS', nextValue: 3 },
      { tenantId, key: 'asset', prefix: 'AST', nextValue: 104 },
    ],
  });

  console.log(`[seed] GridNova Systems tenant ready (${tenant.slug})`);
  void warranty;
  void asset3;
}

async function seedTenantVoltline(db: Prisma.TransactionClient | PrismaClient = prisma): Promise<void> {
  const tenant = await db.tenant.create({
    data: {
      slug: 'voltline-power',
      name: 'Voltline Power Systems',
      timezone: 'Asia/Kolkata',
      settings: {},
    },
  });
  const owner = await db.user.create({
    data: {
      email: 'owner@voltline.example',
      displayName: 'Arvind Rao',
      passwordHash: await hashPassword('DemoOwner#2026'),
      memberships: { create: { tenantId: tenant.id, role: 'owner', status: 'active' } },
    },
  });
  const apex = await db.customerAccount.create({
    data: {
      tenantId: tenant.id,
      accountCode: 'CUS-000001',
      legalName: 'Apex Steel Works',
      segment: 'Steel',
    },
  });
  const site = await db.site.create({
    data: { tenantId: tenant.id, customerId: apex.id, siteCode: 'APEX-NASHIK-01', name: 'Nashik Rolling Mill' },
  });
  await db.asset.create({
    data: {
      tenantId: tenant.id,
      siteId: site.id,
      assetCode: 'AST-000101',
      serialNumber: 'VLT-RMU-2025-0091',
      assetFamily: 'rmu',
      manufacturer: 'Voltline Power Systems',
      model: 'VLT-RMU-24',
      commissioningDate: new Date('2025-08-20'),
      specification: {
        schemaVersion: 1,
        electrical: { voltageClassKv: 24, ratedCurrentA: 630, insulationMedium: 'sf6' },
      } as Prisma.InputJsonValue,
    },
  });
  await db.auditEvent.create({
    data: { tenantId: tenant.id, actorUserId: owner.id, action: 'tenant.created', resourceType: 'tenant', resourceId: tenant.id },
  });
  const year = new Date().getUTCFullYear();
  await db.numberSequence.createMany({
    data: [
      { tenantId: tenant.id, key: `service_request:${year}`, prefix: 'SR', nextValue: 1 },
      { tenantId: tenant.id, key: `work_order:${year}`, prefix: 'WO', nextValue: 1 },
      { tenantId: tenant.id, key: `contract:${year}`, prefix: 'CTR', nextValue: 1 },
      { tenantId: tenant.id, key: 'customer', prefix: 'CUS', nextValue: 2 },
      { tenantId: tenant.id, key: 'asset', prefix: 'AST', nextValue: 102 },
    ],
  });
  console.log(`[seed] Voltline Power tenant ready (${tenant.slug}) — same asset codes as GridNova prove tenant scoping`);
}

main()
  .catch((e) => {
    console.error('[seed] failed:', e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
