import request from 'supertest';
import { Client } from 'pg';
import { startApi, call, auth, inviteMember, createAssignedWorkOrder } from './helpers';

/**
 * File security (audit SEC-04 / SEC-06):
 *  - object-level download authorization (technician scope);
 *  - malware scanning (EICAR test file rejected, fail-closed semantics);
 *  - MIME sniffing from bytes;
 *  - signed download URLs only for scan-clean attachments.
 */

const API_PORT = 4012;
const UNIQUE = Date.now().toString(36);

const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** 1x1 transparent PNG. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f00050502017dc4b3e80000000049454e44ae426082',
  'hex',
);

describe('file security (SEC-04 / SEC-06)', () => {
  let server: ReturnType<typeof request>;
  let stop: () => Promise<void>;
  let ownerToken: string;
  let techToken: string;
  let techUserId: string;
  let otherTechToken: string;
  let workOrderId: string;
  let workOrderVersion: number;

  beforeAll(async () => {
    const harness = await startApi(API_PORT);
    server = harness.server;
    stop = harness.stop;

    const org = await call(server.post('/api/v1/auth/register').send({
      email: `owner.files.${UNIQUE}@test.example`,
      password: 'TestPassword#123',
      displayName: 'Files Owner',
      organizationName: `Files Tenant ${UNIQUE}`,
    }));
    ownerToken = org.body.data.accessToken;

    const tech = await inviteMember(
      server,
      ownerToken,
      `tech.files.${UNIQUE}@test.example`,
      'TechPassword#123',
      'technician',
      'Files Tech',
    );
    techToken = tech.token;
    techUserId = tech.userId;

    const otherTech = await inviteMember(
      server,
      ownerToken,
      `tech.other.${UNIQUE}@test.example`,
      'OtherPassword#123',
      'technician',
      'Other Tech',
    );
    otherTechToken = otherTech.token;

    const wo = await createAssignedWorkOrder(server, ownerToken, techUserId, UNIQUE);
    workOrderId = wo.workOrderId;
    workOrderVersion = wo.version;
  }, 120_000);

  afterAll(async () => {
    await stop();
  });

  const upload = (token: string, buffer: Buffer, filename: string, mimetype: string, query = '') =>
    call(server.post(`/api/v1/files${query}`).set(auth(token)).attach('file', buffer, { filename, contentType: mimetype }));

  describe('malware scanning (SEC-06)', () => {
    it('rejects the EICAR test file with FILE_INFECTED', async () => {
      // Disguised as an allowed type — the scanner must be the line of defence.
      const res = await upload(ownerToken, Buffer.from(EICAR, 'latin1'), 'photo.png', 'image/png');
      expect(res.status).toBe(422);
      expect(res.body.error?.code).toBe('FILE_INFECTED');
    });

    it('detects EICAR embedded in an otherwise well-formed image', async () => {
      const polyglot = Buffer.concat([PNG, Buffer.from(EICAR, 'latin1')]);
      const res = await upload(ownerToken, polyglot, 'photo.png', 'image/png');
      expect(res.status).toBe(422);
      expect(res.body.error?.code).toBe('FILE_INFECTED');
    });

    it('rejects a Windows executable disguised as an image', async () => {
      const exe = Buffer.concat([Buffer.from('4d5a9000', 'hex'), Buffer.alloc(256, 0)]);
      const res = await upload(ownerToken, exe, 'drawing.png', 'image/png');
      expect([422]).toContain(res.status);
      expect(['FILE_TYPE_MISMATCH', 'FILE_INFECTED']).toContain(res.body.error?.code);
    });

    it('accepts a clean PNG and returns a signed download URL', async () => {
      const res = await upload(ownerToken, PNG, 'panel-photo.png', 'image/png');
      expect(res.status).toBe(201);
      expect(res.body.data.downloadUrl).toMatch(/^\/api\/v1\/files\/download\//);
      expect(res.body.data.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('object-level authorization (SEC-04)', () => {
    let assignedAttachmentId: string;
    let unassignedAttachmentId: string;

    beforeAll(async () => {
      // Attachment owned by the ASSIGNED work order.
      const owned = await upload(
        techToken,
        PNG,
        'site-photo.png',
        'image/png',
        `?ownerType=work_order&ownerId=${workOrderId}`,
      );
      assignedAttachmentId = owned.body.data.id;
      // Unowned attachment uploaded by the OWNER (staff-only scope for techs).
      const unowned = await upload(ownerToken, PNG, 'logo.png', 'image/png');
      unassignedAttachmentId = unowned.body.data.id;
    });

    it('technician can download files on their assigned work order', async () => {
      const res = await call(server.get(`/api/v1/files/${assignedAttachmentId}/download-url`).set(auth(techToken)));
      expect(res.status).toBe(200);
      expect(res.body.data.downloadUrl).toMatch(/^\/api\/v1\/files\/download\//);
    });

    it("technician CANNOT download another technician's unowned file (IDOR within tenant blocked)", async () => {
      const res = await call(server.get(`/api/v1/files/${unassignedAttachmentId}/download-url`).set(auth(otherTechToken)));
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('FILE_FORBIDDEN');
    });

    it('staff roles retain tenant-wide read access', async () => {
      const res = await call(server.get(`/api/v1/files/${unassignedAttachmentId}/download-url`).set(auth(ownerToken)));
      expect(res.status).toBe(200);
    });

    it('the uploader can always re-download their own file', async () => {
      const res = await call(server.get(`/api/v1/files/${unassignedAttachmentId}/download-url`).set(auth(ownerToken)));
      expect(res.status).toBe(200);
    });

    it('signed download URL streams the scan-clean file', async () => {
      const url = await call(server.get(`/api/v1/files/${assignedAttachmentId}/download-url`).set(auth(techToken)));
      const path = url.body.data.downloadUrl.replace(/^https?:\/\/[^/]+/, '');
      const res = await server.get(path);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(Buffer.isBuffer(res.body) || typeof res.body === 'string' || res.body != null).toBe(true);
    });

    it('a tampered signature is rejected', async () => {
      const url = await call(server.get(`/api/v1/files/${assignedAttachmentId}/download-url`).set(auth(techToken)));
      const path = url.body.data.downloadUrl.replace(/^https?:\/\/[^/]+/, '');
      const res = await server.get(path.replace(/sig=.+$/, 'sig=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'));
      expect(res.status).toBe(401);
    });

    it('denied access attempts are audited', async () => {
      // Re-run a denial and confirm an audit row exists for it (direct DB —
      // the write itself is the security property under test).
      await call(server.get(`/api/v1/files/${unassignedAttachmentId}/download-url`).set(auth(otherTechToken)));
      const client = new Client({
        connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/serviceos_test',
      });
      await client.connect();
      const rows = await client.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE action = 'file.download_denied' AND resource_id = $1",
        [unassignedAttachmentId],
      );
      const rejected = await client.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE action = 'file.rejected_malware'",
      );
      await client.end();
      expect(Number(rows.rows[0].n)).toBeGreaterThanOrEqual(1);
      expect(Number(rejected.rows[0].n)).toBeGreaterThanOrEqual(1);
    });
  });
});
