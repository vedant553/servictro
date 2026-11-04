import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { TenantDbService, type TenantTx } from '../../common/tenant/tenant-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Errors, DomainError } from '../../common/errors/domain.error';
import type { TenantContext } from '../../common/tenant/tenant-context';

/** Structural type for the pdfkit document (its @types export shape is awkward). */
type PdfDoc = {
  font(f: string): PdfDoc;
  fontSize(s: number): PdfDoc;
  fillColor(c: string): PdfDoc;
  text(t: string, x?: number | Record<string, unknown>, y?: number, opts?: Record<string, unknown>): PdfDoc;
  moveTo(x: number, y: number): PdfDoc;
  lineTo(x: number, y: number): PdfDoc;
  lineWidth(w: number): PdfDoc;
  strokeColor(c: string): PdfDoc;
  stroke(): PdfDoc;
  moveDown(n?: number): PdfDoc;
  on(e: string, cb: (chunk: Buffer) => void): PdfDoc;
  end(): PdfDoc;
  switchToPage(i: number): PdfDoc;
  bufferedPageRange(): { start: number; count: number };
  page: { margins: { left: number } };
  y: number;
};

/**
 * Digital service reports (Blueprint RPT-01, Tech Spec §13.4): generated from
 * the immutable work-order snapshot, versioned, immutable once published; a
 * corrected report is a NEW version with a visible supersedes reference.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Generate (or re-generate as draft) the report PDF for a work order. */
  async generate(ctx: TenantContext, workOrderId: string) {
    const reportId = await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const wo = await tx.workOrder.findFirst({
        where: { id: workOrderId },
        include: {
          customer: true,
          site: true,
          asset: true,
          checklistTemplateVersion: true,
          checklistResults: { orderBy: { itemKey: 'asc' } },
          measurements: { orderBy: { serverReceivedAt: 'asc' } },
          observations: { orderBy: { createdAt: 'asc' } },
          partsUsage: true,
          assignments: { where: { status: { in: ['accepted', 'active', 'completed'] } }, include: { user: { select: { displayName: true } } } },
          serviceReports: { orderBy: { reportVersion: 'desc' }, take: 1 },
        },
      });
      if (!wo) throw Errors.notFound('Work order');
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { name: true, legalName: true },
      });
      if (!['pending_review', 'in_progress', 'completed', 'closed'].includes(wo.status)) {
        throw new DomainError(
          'REPORT_NOT_GENERATABLE',
          `A report is generated once work is submitted for review (current: ${wo.status})`,
          409,
        );
      }
      // Correction path: latest published report stays immutable; a new
      // version supersedes it (Tech Spec §12.3 — closed WOs are never edited).
      const latest = wo.serviceReports[0] ?? null;
      let reportVersion = 1;
      let supersedesReportId: string | null = null;
      if (latest) {
        if (latest.status === 'published') {
          reportVersion = latest.reportVersion + 1;
          supersedesReportId = latest.id;
          await tx.serviceReport.update({ where: { id: latest.id }, data: { status: 'superseded' } });
        } else {
          reportVersion = latest.reportVersion;
        }
      }
      const definition = (wo.checklistTemplateVersion?.definition ?? { items: [] }) as {
        items: Array<{ key: string; label: string; unit?: string }>;
      };
      const itemLabel = new Map(definition.items.map((i) => [i.key, i.label]));
      const techs = wo.assignments.map((a) => a.user.displayName).join(', ') || '—';

      const pdfBytes = await this.renderPdf({
        tenantName: tenant?.legalName ?? tenant?.name ?? 'ServiceOS tenant',
        workOrderNo: wo.workOrderNo,
        status: wo.status,
        customerName: wo.customer.legalName,
        customerCode: wo.customer.accountCode,
        siteName: wo.site.name,
        siteAddress: this.formatAddress(wo.site.address as Record<string, string>),
        asset: wo.asset
          ? `${wo.asset.assetCode} — ${wo.asset.assetFamily.replace(/_/g, ' ')}${wo.asset.serialNumber ? ` (S/N ${wo.asset.serialNumber})` : ''}`
          : '—',
        title: wo.title,
        description: wo.description ?? '',
        technicians: techs,
        scheduled: wo.scheduledStartAt ? wo.scheduledStartAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—',
        completedAt: wo.completedAt ? wo.completedAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—',
        completionSummary: wo.completionSummary ?? '',
        checklist: wo.checklistResults.map((r) => ({
          label: itemLabel.get(r.itemKey) ?? r.itemKey,
          outcome: r.outcome,
          value: r.valueNumeric?.toString() ?? '',
          unit: r.unit ?? '',
          note: r.note ?? '',
          exception: r.exceptionReason ?? '',
        })),
        measurements: wo.measurements.map((m) => ({
          key: m.measurementKey,
          value: m.measuredValue.toString(),
          unit: m.unit,
          phase: m.phase ?? '',
          instrument: m.instrumentId ?? '',
        })),
        observations: wo.observations.map((o) => ({ kind: o.kind, text: o.text })),
        parts: wo.partsUsage.map((p) => ({
          code: p.partCode, description: p.description ?? '', qty: p.quantity.toString(), unit: p.unit,
        })),
        acknowledgement: latest
          ? {
              name: latest.acknowledgedByName ?? '',
              role: latest.acknowledgedByRole ?? '',
              method: latest.acknowledgementMethod ?? '',
              at: latest.acknowledgedAt ? latest.acknowledgedAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '',
              notSignedReason: latest.notSignedReason ?? '',
            }
          : null,
        reportVersion,
      });

      const attachment = await this.files.putGenerated(
        tx,
        ctx.tenantId,
        ctx.user.id,
        pdfBytes,
        'application/pdf',
        `service-report-${wo.workOrderNo}-v${reportVersion}.pdf`,
        'service_report',
        workOrderId,
      );
      const report = await tx.serviceReport.upsert({
        where: { tenantId_workOrderId_reportVersion: { tenantId: ctx.tenantId, workOrderId, reportVersion } },
        create: {
          workOrderId,
          reportVersion,
          status: 'pending_review',
          summary: wo.completionSummary,
          generatedAttachmentId: attachment.id,
          supersedesReportId,
        },
        update: {
          status: 'pending_review',
          summary: wo.completionSummary,
          generatedAttachmentId: attachment.id,
          approvedById: null,
          approvedAt: null,
        },
      });
      await tx.workOrderEvent.create({
        data: { workOrderId, eventType: 'report_generated', actorUserId: ctx.user.id, metadata: { reportVersion } },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'report.generated',
        resourceType: 'service_report',
        resourceId: report.id,
        requestId: ctx.requestId,
        metadata: { workOrderNo: wo.workOrderNo, reportVersion },
      });
      return report.id;
    });
    return this.getReport(ctx, reportId);
  }

  /** Reviewer approval — required before the work order can complete. */
  async approve(ctx: TenantContext, reportId: string) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const report = await tx.serviceReport.findFirst({ where: { id: reportId } });
      if (!report) throw Errors.notFound('Report');
      if (report.status !== 'pending_review') {
        throw new DomainError('REPORT_NOT_APPROVABLE', `Only pending reports can be approved (current: ${report.status})`, 409);
      }
      await tx.serviceReport.update({
        where: { id: reportId },
        data: { status: 'approved', approvedById: ctx.user.id, approvedAt: new Date() },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'report.approved',
        resourceType: 'service_report',
        resourceId: reportId,
        requestId: ctx.requestId,
      });
    });
    return this.getReport(ctx, reportId);
  }

  /** Publish: the report becomes immutable and the download link becomes available. */
  async publish(ctx: TenantContext, reportId: string) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const report = await tx.serviceReport.findFirst({
        where: { id: reportId },
        include: { workOrder: { select: { workOrderNo: true } } },
      });
      if (!report) throw Errors.notFound('Report');
      if (report.status !== 'approved') {
        throw new DomainError('REPORT_NOT_PUBLISHABLE', 'Approve the report before publishing', 409);
      }
      await tx.serviceReport.update({ where: { id: reportId }, data: { status: 'published', publishedAt: new Date() } });
      await tx.workOrderEvent.create({
        data: { workOrderId: report.workOrderId, eventType: 'report_published', actorUserId: ctx.user.id },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'report.published',
        resourceType: 'service_report',
        resourceId: reportId,
        requestId: ctx.requestId,
        metadata: { workOrderNo: report.workOrder.workOrderNo },
      });
      await this.notifications.createForRoles(tx, ctx.tenantId, ['service_manager', 'coordinator', 'admin', 'owner'], {
        category: 'report_published',
        title: `Report published — ${report.workOrder.workOrderNo}`,
        body: `Service report v${report.reportVersion} is published and attached to the asset history.`,
        entityType: 'service_report',
        entityId: reportId,
      });
    });
    return this.getReport(ctx, reportId);
  }

  async getReport(ctx: TenantContext, reportId: string) {
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const report = await tx.serviceReport.findFirst({
        where: { id: reportId },
        include: {
          workOrder: { select: { id: true, workOrderNo: true, title: true, status: true } },
          generatedAttachment: { select: { id: true, originalName: true, contentType: true, sizeBytes: true, status: true } },
        },
      });
      if (!report) throw Errors.notFound('Report');
      const downloadUrl = report.generatedAttachment
        ? (await this.files.getDownloadUrl(ctx, report.generatedAttachment.id)).downloadUrl
        : null;
      return { ...report, downloadUrl };
    });
  }

  async listForWorkOrder(tx: TenantTx, workOrderId: string) {
    return tx.serviceReport.findMany({
      where: { workOrderId },
      orderBy: { reportVersion: 'desc' },
    });
  }

  // -------------------------------------------------------------------------
  // PDF rendering (pdfkit) — content mirrors the immutable WO snapshot.
  // -------------------------------------------------------------------------

  private formatAddress(address: Record<string, string> | null | undefined): string {
    if (!address) return '—';
    return [address.line1, address.city, address.state, address.postalCode, address.country]
      .filter(Boolean)
      .join(', ') || '—';
  }

  private async renderPdf(data: {
    tenantName: string; workOrderNo: string; status: string;
    customerName: string; customerCode: string; siteName: string; siteAddress: string; asset: string;
    title: string; description: string; technicians: string; scheduled: string; completedAt: string;
    completionSummary: string;
    checklist: Array<{ label: string; outcome: string; value: string; unit: string; note: string; exception: string }>;
    measurements: Array<{ key: string; value: string; unit: string; phase: string; instrument: string }>;
    observations: Array<{ kind: string; text: string }>;
    parts: Array<{ code: string; description: string; qty: string; unit: string }>;
    acknowledgement: { name: string; role: string; method: string; at: string; notSignedReason: string } | null;
    reportVersion: number;
  }): Promise<Buffer> {
    const doc = new (PDFDocument as unknown as { new (opts: Record<string, unknown>): PdfDoc })({
      size: 'A4',
      margin: 48,
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve) => {
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const navy = '#0B1F33';
    const blue = '#2563EB';
    const grey = '#64748B';

    // Header
    doc.fontSize(18).fillColor(navy).font('Helvetica-Bold').text(data.tenantName, { align: 'left' });
    doc.fontSize(10).fillColor(grey).font('Helvetica').text('Service Report', { align: 'left' });
    doc.moveDown(0.4);
    doc.fontSize(13).fillColor(blue).font('Helvetica-Bold').text(`${data.workOrderNo} — ${data.title}`);
    doc.fontSize(9).fillColor(grey).font('Helvetica')
      .text(`Report v${data.reportVersion} · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · work order status: ${data.status.replace(/_/g, ' ')}`);
    doc.moveDown(0.8);
    doc.moveTo(48, doc.y).lineTo(547, doc.y).lineWidth(1).strokeColor('#CBD5E1').stroke();
    doc.moveDown(0.8);

    // Parties + asset
    const row = (label: string, value: string) => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(navy).text(label, { continued: false });
      doc.font('Helvetica').fontSize(9).fillColor('#111').text(value || '—');
      doc.moveDown(0.35);
    };
    row('Customer', `${data.customerName} (${data.customerCode})`);
    row('Site', `${data.siteName} — ${data.siteAddress}`);
    row('Equipment', data.asset);
    row('Technician(s)', data.technicians);
    row('Scheduled visit', data.scheduled);
    row('Work completed', data.completedAt);
    doc.moveDown(0.4);

    if (data.completionSummary) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor(navy).text('Work performed');
      doc.font('Helvetica').fontSize(9).fillColor('#111').text(data.completionSummary, { lineGap: 2 });
      doc.moveDown(0.6);
    }

    if (data.checklist.length > 0) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor(navy).text('Checklist results');
      this.table(doc, ['Item', 'Result', 'Value', 'Remarks'], data.checklist.map((c) => [
        c.label,
        c.outcome.replace(/_/g, ' ').toUpperCase(),
        c.value ? `${c.value} ${c.unit}` : '',
        c.exception ? `EXCEPTION: ${c.exception}` : c.note,
      ]));
      doc.moveDown(0.6);
    }

    if (data.measurements.length > 0) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor(navy).text('Measurements');
      this.table(doc, ['Measurement', 'Value', 'Phase', 'Instrument'], data.measurements.map((m) => [
        m.key.replace(/_/g, ' '),
        `${m.value} ${m.unit}`,
        m.phase,
        m.instrument,
      ]));
      doc.moveDown(0.6);
    }

    if (data.observations.length > 0) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor(navy).text('Observations & actions');
      for (const o of data.observations) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor(grey).text(o.kind.toUpperCase());
        doc.font('Helvetica').fontSize(9).fillColor('#111').text(o.text, { lineGap: 2 });
        doc.moveDown(0.25);
      }
      doc.moveDown(0.4);
    }

    if (data.parts.length > 0) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor(navy).text('Parts used');
      this.table(doc, ['Part', 'Description', 'Qty'], data.parts.map((p) => [p.code, p.description, `${p.qty} ${p.unit}`]));
      doc.moveDown(0.6);
    }

    // Acknowledgement block — clearly labelled as acknowledgement, NOT a
    // safety certificate (Blueprint safety boundary).
    doc.font('Helvetica-Bold').fontSize(11).fillColor(navy).text('Customer acknowledgement');
    doc.font('Helvetica').fontSize(8.5).fillColor(grey)
      .text('Acknowledgement of work performed — not an electrical safety certificate or statutory sign-off.', { lineGap: 1 });
    doc.moveDown(0.3);
    if (data.acknowledgement && data.acknowledgement.name) {
      row('Acknowledged by', `${data.acknowledgement.name}${data.acknowledgement.role ? ` (${data.acknowledgement.role})` : ''}`);
      row('Method', data.acknowledgement.method.replace(/_/g, ' '));
      row('At', data.acknowledgement.at);
      if (data.acknowledgement.notSignedReason) row('Not signed — reason', data.acknowledgement.notSignedReason);
    } else {
      row('Acknowledgement', 'Pending');
    }

    // Footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(7.5).fillColor(grey).text(
        `${data.tenantName} · ${data.workOrderNo} · report v${data.reportVersion} · page ${i + 1} of ${range.count}`,
        48, 800, { lineBreak: false },
      );
    }
    doc.end();
    return done;
  }

  private table(doc: PdfDoc, headers: string[], rows: string[][]): void {
    const widths = [180, 90, 110, 119];
    const x0 = doc.page.margins.left;
    let y = doc.y;
    const drawRow = (cells: string[], bold: boolean) => {
      let x = x0;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(bold ? '#0B1F33' : '#111');
      cells.forEach((cell, i) => {
        doc.text(String(cell ?? '').slice(0, 90), x + 2, y + 1, { width: widths[i] - 4, lineBreak: false, ellipsis: true, height: 12 });
        x += widths[i];
      });
      y += 14;
      doc.moveTo(x0, y).lineTo(x0 + widths.reduce((a, b) => a + b, 0), y).lineWidth(0.5).strokeColor('#E2E8F0').stroke();
    };
    drawRow(headers, true);
    for (const row of rows) drawRow(row, false);
    if (rows.length === 0) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#64748B').text('— none recorded —', x0 + 2, y + 1);
      y += 14;
    }
    doc.y = y + 6;
  }
}
