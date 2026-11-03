const assert = require('node:assert/strict');
const test = require('node:test');
const { compare } = require('bcryptjs');
const { BadRequestException, ConflictException } = require('@nestjs/common');
const { AdminService } = require('../dist/admin.service.js');

function createHarness({ employee, activeShift = null, updateError = null } = {}) {
  const calls = { create: [], findMany: [], update: [], audit: [] };
  const prisma = {
    user: {
      create: async ({ data }) => {
        calls.create.push(data);
        return {
          id: 'employee-1',
          name: data.name,
          email: data.email,
          role: data.role,
          isActive: true,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        };
      },
      findMany: async (args) => {
        calls.findMany.push(args);
        return [];
      },
      findUnique: async () => employee,
      update: async ({ data }) => {
        calls.update.push(data);
        if (updateError) throw updateError;
        return {
          id: 'employee-1',
          name: data.name ?? employee.name,
          email: data.email ?? employee.email,
          role: data.role ?? employee?.role ?? 'EMPLOYEE',
          isActive: data.isActive ?? employee.isActive,
          createdAt: employee.createdAt,
        };
      },
    },
    shift: {
      findFirst: async () => activeShift,
    },
    adminAuditLog: {
      create: async ({ data }) => {
        calls.audit.push(data);
        return { id: `audit-${calls.audit.length}`, ...data, createdAt: new Date() };
      },
      count: async () => calls.audit.length,
      findMany: async () => calls.audit,
    },
    systemSettings: {
      upsert: async ({ create }) => ({ id: 'global', ...create }),
    },
    $transaction: async (operation) => Array.isArray(operation)
      ? Promise.all(operation)
      : operation(prisma),
  };
  return { service: new AdminService(prisma), calls };
}

const actor = { id: 'admin-1', name: 'Admin User', email: 'admin@example.com' };

test('creates an employee with a normalized email and a hashed password', async () => {
  const { service, calls } = createHarness();
  const created = await service.createEmployee({
    name: '  Alex Employee  ',
    email: ' Alex@Example.com ',
    password: 'a-long-temporary-password',
  }, actor);

  assert.equal(created.name, 'Alex Employee');
  assert.equal(created.email, 'alex@example.com');
  assert.equal(calls.create[0].role, 'EMPLOYEE');
  assert.equal(await compare('a-long-temporary-password', calls.create[0].passwordHash), true);
  assert.equal(calls.audit[0].actorId, actor.id);
  assert.equal(calls.audit[0].action, 'EMPLOYEE_CREATED');
  assert.equal(JSON.stringify(calls.audit[0]).includes('a-long-temporary-password'), false);
});

test('lists only employee accounts', async () => {
  const { service, calls } = createHarness();
  await service.listEmployees();
  assert.deepEqual(calls.findMany[0].where, { role: 'EMPLOYEE' });
});

test('returns all active shift totals separately from the paged shift list', async () => {
  const service = new AdminService({
    shift: {
      count: async ({ where }) => where.endedAt === null ? 3 : 12,
      findMany: async () => [],
    },
    $transaction: async (operations) => Promise.all(operations),
  });
  const result = await service.listShifts(
    '2026-01-01T00:00:00.000Z',
    '2026-01-02T00:00:00.000Z',
    1,
    50,
  );
  assert.equal(result.total, 12);
  assert.equal(result.activeShifts, 3);
  assert.equal(result.shifts.length, 0);
});

test('updates employee profile, email, password and active status', async () => {
  const { service, calls } = createHarness({
    employee: {
      role: 'EMPLOYEE',
      isActive: true,
      name: 'Alex Employee',
      email: 'alex@example.com',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
  });
  const updated = await service.updateEmployee('employee-1', {
    name: '  Alex Updated ',
    email: ' ALEX2@example.com ',
    password: 'another-temporary-password',
    isActive: false,
  }, actor);

  assert.equal(updated.name, 'Alex Updated');
  assert.equal(updated.email, 'alex2@example.com');
  assert.equal(updated.isActive, false);
  assert.equal(await compare('another-temporary-password', calls.update[0].passwordHash), true);
  assert.equal(Object.hasOwn(updated, 'passwordHash'), false);
  assert.equal(calls.audit[0].action, 'EMPLOYEE_PASSWORD_RESET');
  assert.match(calls.audit[0].summary, /password reset/);
  assert.equal(JSON.stringify(calls.audit[0]).includes('another-temporary-password'), false);
});

test('does not disable an employee with an active shift', async () => {
  const { service, calls } = createHarness({
    employee: { role: 'EMPLOYEE', isActive: true },
    activeShift: { id: 'shift-1' },
  });
  await assert.rejects(
    service.updateEmployee('employee-1', { isActive: false }, actor),
    (error) => error instanceof BadRequestException && /active shift/.test(error.message),
  );
  assert.equal(calls.update.length, 0);
});

test('reports duplicate email updates as a conflict', async () => {
  const { service } = createHarness({
    employee: { role: 'EMPLOYEE', isActive: true },
    updateError: { code: 'P2002' },
  });
  await assert.rejects(
    service.updateEmployee('employee-1', { email: 'taken@example.com' }, actor),
    (error) => error instanceof ConflictException,
  );
});

test('filters attendance by employee and shift status', async () => {
  let observedShiftWhere;
  let observedActiveWhere;
  const service = new AdminService({
    shift: {
      count: async ({ where }) => {
        if (where.endedAt === null) observedActiveWhere = where;
        return 0;
      },
      findMany: async ({ where }) => {
        observedShiftWhere = where;
        return [];
      },
    },
    $transaction: async (operations) => Promise.all(operations),
  });
  await service.listShifts(
    '2026-01-01T00:00:00.000Z',
    '2026-01-02T00:00:00.000Z',
    1,
    50,
    ' Alex ',
    'active',
  );
  assert.equal(observedShiftWhere.endedAt, null);
  assert.deepEqual(observedShiftWhere.employee.OR, [
    { name: { contains: 'Alex', mode: 'insensitive' } },
    { email: { contains: 'Alex', mode: 'insensitive' } },
  ]);
  assert.equal(observedActiveWhere.endedAt, null);
  assert.equal(observedActiveWhere.employee, undefined);
});

test('returns paged audit history', async () => {
  const { service, calls } = createHarness();
  await service.createEmployee({
    name: 'Alex Employee',
    email: 'alex@example.com',
    password: 'a-long-temporary-password',
  }, actor);
  const result = await service.listAuditLog(1, 25);
  assert.equal(result.total, 1);
  assert.equal(result.pageSize, 25);
  assert.equal(result.entries[0].action, 'EMPLOYEE_CREATED');
  assert.equal(calls.audit.length, 1);
});

test('audits administrator role changes without recording secrets', async () => {
  const { service, calls } = createHarness({
    employee: {
      role: 'ADMIN',
      isActive: true,
      name: 'Team Admin',
      email: 'team@example.com',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
  });
  const updated = await service.updateAdmin(
    'employee-1',
    { role: 'SUPERADMIN', password: 'a-new-secret-password' },
    actor,
  );
  assert.equal(updated.role, 'SUPERADMIN');
  assert.equal(calls.audit[0].action, 'ADMIN_PASSWORD_RESET');
  assert.match(calls.audit[0].summary, /role set to SUPERADMIN/);
  assert.equal(JSON.stringify(calls.audit[0]).includes('a-new-secret-password'), false);
});

test('audits retention setting changes', async () => {
  const { service, calls } = createHarness();
  await service.updateSettings(180, actor);
  assert.equal(calls.audit[0].action, 'SETTINGS_UPDATED');
  assert.equal(calls.audit[0].summary, 'Set location retention to 180 days.');
});

test('summarizes route coverage and computes per-point segment estimates', async () => {
  const samples = [
    { latitude: 40, longitude: -73, accuracy: 10, capturedAt: new Date('2026-01-01T09:00:00Z'), isMocked: false },
    { latitude: 40.001, longitude: -73, accuracy: 30, capturedAt: new Date('2026-01-01T09:01:00Z'), isMocked: true },
    { latitude: 40.002, longitude: -73, accuracy: 20, capturedAt: new Date('2026-01-01T09:20:00Z'), isMocked: false },
  ];
  const service = new AdminService({
    shift: {
      findUnique: async () => ({
        id: 'shift-1',
        employee: { name: 'Alex' },
        startedAt: new Date('2026-01-01T09:00:00Z'),
        endedAt: new Date('2026-01-01T10:00:00Z'),
        checkInLat: 40,
        checkInLng: -73,
        checkInAcc: 8,
        checkOutLat: 40.002,
        checkOutLng: -73,
        checkOutAcc: 12,
        distanceMeters: null,
        samples,
      }),
    },
  });

  const route = await service.getRoute('shift-1');
  assert.equal(route.points.length, 3);
  assert.equal(route.points[0].segmentDistanceMeters, 0);
  assert.ok(route.points[1].segmentDistanceMeters > 100);
  assert.equal(route.quality.coverage, 'partial');
  assert.equal(route.quality.averageAccuracyMeters, 20);
  assert.equal(route.quality.maxGapSeconds, 1140);
  assert.equal(route.quality.significantGapCount, 1);
  assert.equal(route.quality.mockedPointCount, 1);
  assert.equal(route.startLocation.latitude, 40);
  assert.equal(route.endLocation.longitude, -73);
});

test('marks routes with very sparse or inaccurate samples as limited coverage', async () => {
  const samples = [
    { latitude: 40, longitude: -73, accuracy: 20, capturedAt: new Date('2026-01-01T09:00:00Z'), isMocked: false },
    { latitude: 40.001, longitude: -73, accuracy: 90, capturedAt: new Date('2026-01-01T09:31:00Z'), isMocked: false },
  ];
  const service = new AdminService({
    shift: {
      findUnique: async () => ({
        id: 'shift-1',
        employee: { name: 'Alex' },
        startedAt: samples[0].capturedAt,
        endedAt: samples[1].capturedAt,
        checkInLat: null,
        checkInLng: null,
        checkInAcc: null,
        checkOutLat: null,
        checkOutLng: null,
        checkOutAcc: null,
        distanceMeters: 100,
        samples,
      }),
    },
  });

  const route = await service.getRoute('shift-1');
  assert.equal(route.quality.coverage, 'limited');
  assert.equal(route.quality.maxGapSeconds, 1860);
  assert.equal(route.quality.averageAccuracyMeters, 55);
});
