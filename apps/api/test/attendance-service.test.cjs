const assert = require('node:assert/strict');
const test = require('node:test');
const { UnauthorizedException } = require('@nestjs/common');
const { AttendanceService } = require('../dist/attendance.service.js');

function createService({ employee, shift } = {}) {
  let createdShift;
  const transaction = {
    user: { findUnique: async () => employee },
    shift: {
      create: async ({ data }) => {
        createdShift = data;
        return { id: 'shift-1', startedAt: new Date('2026-01-01T08:00:00Z') };
      },
    },
  };
  const prisma = {
    $transaction: async (callback) => callback(transaction),
  };
  return {
    service: new AttendanceService(prisma),
    getCreatedShift: () => createdShift,
  };
}

const location = { latitude: 40, longitude: -70, accuracy: 10, isMocked: false };

test('checks account status again before starting an employee shift', async () => {
  const { service, getCreatedShift } = createService({
    employee: { role: 'EMPLOYEE', isActive: false },
  });
  await assert.rejects(
    service.checkIn('employee-1', location),
    (error) => error instanceof UnauthorizedException,
  );
  assert.equal(getCreatedShift(), undefined);
});

test('starts shifts for active employee accounts', async () => {
  const { service, getCreatedShift } = createService({
    employee: { role: 'EMPLOYEE', isActive: true },
  });
  const result = await service.checkIn('employee-1', location);
  assert.equal(result.shiftId, 'shift-1');
  assert.equal(getCreatedShift().employeeId, 'employee-1');
  assert.equal(getCreatedShift().activeEmployeeId, 'employee-1');
});
