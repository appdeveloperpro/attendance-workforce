const assert = require('node:assert/strict');
const test = require('node:test');
const { compare } = require('bcryptjs');
const { BadRequestException, ConflictException } = require('@nestjs/common');
const { AdminService } = require('../dist/admin.service.js');

function createHarness({ employee, activeShift = null, updateError = null } = {}) {
  const calls = { create: [], findMany: [], update: [] };
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
          role: 'EMPLOYEE',
          isActive: data.isActive ?? employee.isActive,
          createdAt: employee.createdAt,
        };
      },
    },
    shift: {
      findFirst: async () => activeShift,
    },
    $transaction: async (callback) => callback(prisma),
  };
  return { service: new AdminService(prisma), calls };
}

test('creates an employee with a normalized email and a hashed password', async () => {
  const { service, calls } = createHarness();
  const created = await service.createEmployee({
    name: '  Alex Employee  ',
    email: ' Alex@Example.com ',
    password: 'a-long-temporary-password',
  });

  assert.equal(created.name, 'Alex Employee');
  assert.equal(created.email, 'alex@example.com');
  assert.equal(calls.create[0].role, 'EMPLOYEE');
  assert.equal(await compare('a-long-temporary-password', calls.create[0].passwordHash), true);
});

test('lists only employee accounts', async () => {
  const { service, calls } = createHarness();
  await service.listEmployees();
  assert.deepEqual(calls.findMany[0].where, { role: 'EMPLOYEE' });
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
  });

  assert.equal(updated.name, 'Alex Updated');
  assert.equal(updated.email, 'alex2@example.com');
  assert.equal(updated.isActive, false);
  assert.equal(await compare('another-temporary-password', calls.update[0].passwordHash), true);
  assert.equal(Object.hasOwn(updated, 'passwordHash'), false);
});

test('does not disable an employee with an active shift', async () => {
  const { service, calls } = createHarness({
    employee: { role: 'EMPLOYEE', isActive: true },
    activeShift: { id: 'shift-1' },
  });
  await assert.rejects(
    service.updateEmployee('employee-1', { isActive: false }),
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
    service.updateEmployee('employee-1', { email: 'taken@example.com' }),
    (error) => error instanceof ConflictException,
  );
});
