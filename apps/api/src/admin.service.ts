import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';
import { PrismaService } from './prisma.service';
import { routeDistance } from './route-distance';

type AuditActor = { id: string; name: string; email: string };

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async createEmployee(input: { name: string; email: string; password: string }, actor: AuditActor) {
    return this.createAccount(input, 'EMPLOYEE', actor);
  }

  async createAdmin(input: { name: string; email: string; password: string }, actor: AuditActor) {
    return this.createAccount(input, 'ADMIN', actor);
  }

  private async createAccount(
    input: { name: string; email: string; password: string },
    role: 'ADMIN' | 'EMPLOYEE',
    actor: AuditActor,
  ) {
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    if (!name) throw new BadRequestException('Name cannot be empty.');
    try {
      const passwordHash = await hash(input.password, 12);
      return await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: { name, email, passwordHash, role },
          select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
        });
        await this.writeAudit(transaction, actor, {
          action: `${role}_CREATED`,
          targetId: user.id,
          targetName: user.name,
          targetEmail: user.email,
          summary: `Created ${role.toLowerCase()} account.`,
        });
        return user;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('An account with this email already exists.');
      }
      throw error;
    }
  }

  listEmployees() {
    return this.prisma.user.findMany({
      where: { role: 'EMPLOYEE' },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async updateEmployee(
    id: string,
    input: { isActive?: boolean; name?: string; email?: string; password?: string },
    actor: AuditActor,
  ) {
    const data: {
      isActive?: boolean;
      name?: string;
      email?: string;
      passwordHash?: string;
    } = {};
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('Name cannot be empty.');
      data.name = name;
    }
    if (input.email !== undefined) data.email = input.email.trim().toLowerCase();
    if (input.password !== undefined) data.passwordHash = await hash(input.password, 12);
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Provide at least one employee field to update.');
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const target = await transaction.user.findUnique({
          where: { id },
          select: { role: true, isActive: true, name: true, email: true },
        });
        if (!target || target.role !== 'EMPLOYEE') {
          throw new NotFoundException('Employee account not found.');
        }

        if (input.isActive === false && target.isActive) {
          const activeShift = await transaction.shift.findFirst({
            where: { employeeId: id, endedAt: null },
            select: { id: true },
          });
          if (activeShift) {
            throw new BadRequestException(
              'This employee has an active shift. Check them out before disabling the account.',
            );
          }
        }

        const updated = await transaction.user.update({
          where: { id },
          data,
          select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
        });
        const changedFields = [
          input.name !== undefined ? 'name' : null,
          input.email !== undefined ? 'email' : null,
          input.password !== undefined ? 'password reset' : null,
          input.isActive !== undefined ? `status set to ${input.isActive ? 'enabled' : 'disabled'}` : null,
        ].filter((field): field is string => field !== null);
        await this.writeAudit(transaction, actor, {
          action: input.password !== undefined
            ? 'EMPLOYEE_PASSWORD_RESET'
            : input.isActive !== undefined ? 'EMPLOYEE_ACCESS_CHANGED' : 'EMPLOYEE_PROFILE_UPDATED',
          targetId: id,
          targetName: updated.name,
          targetEmail: updated.email,
          summary: `Updated employee account: ${changedFields.join(', ')}.`,
        });
        return updated;
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('An account with this email already exists.');
      }
      if (isSerializationConflict(error)) {
        throw new ConflictException('This employee account changed during the update. Refresh and try again.');
      }
      throw error;
    }
  }

  listAdmins() {
    return this.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPERADMIN'] } },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }

  async updateAdmin(
    id: string,
    input: {
      role?: 'ADMIN' | 'SUPERADMIN';
      isActive?: boolean;
      name?: string;
      email?: string;
      password?: string;
    },
    actor: AuditActor,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const target = await transaction.user.findUnique({
        where: { id },
        select: { role: true, isActive: true, name: true, email: true },
      });
      if (!target || (target.role !== 'ADMIN' && target.role !== 'SUPERADMIN')) {
        throw new NotFoundException('Admin account not found.');
      }
      const nextRole = input.role ?? target.role;
      const nextIsActive = input.isActive ?? target.isActive;
      if (id === actor.id && (nextRole !== 'SUPERADMIN' || !nextIsActive)) {
        throw new BadRequestException('You cannot remove your own superadmin access.');
      }
      if (target.role === 'SUPERADMIN' && (nextRole !== 'SUPERADMIN' || !nextIsActive)) {
        const activeSuperadmins = await transaction.user.count({
          where: { role: 'SUPERADMIN', isActive: true },
        });
        if (activeSuperadmins <= 1) {
          throw new BadRequestException('At least one active superadmin account must remain.');
        }
      }

      const data: {
        role?: 'ADMIN' | 'SUPERADMIN';
        isActive?: boolean;
        name?: string;
        email?: string;
        passwordHash?: string;
      } = {};
      if (input.role !== undefined) data.role = input.role;
      if (input.isActive !== undefined) data.isActive = input.isActive;
      if (input.name !== undefined) {
        const name = input.name.trim();
        if (!name) throw new BadRequestException('Name cannot be empty.');
        data.name = name;
      }
      if (input.email !== undefined) data.email = input.email.trim().toLowerCase();
      if (input.password !== undefined) data.passwordHash = await hash(input.password, 12);
      if (Object.keys(data).length === 0) {
        throw new BadRequestException('Provide at least one account field to update.');
      }
      const updated = await transaction.user.update({
        where: { id },
        data,
        select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
      });
      const changedFields = [
        input.name !== undefined ? 'name' : null,
        input.email !== undefined ? 'email' : null,
        input.password !== undefined ? 'password reset' : null,
        input.role !== undefined ? `role set to ${updated.role}` : null,
        input.isActive !== undefined ? `status set to ${input.isActive ? 'enabled' : 'disabled'}` : null,
      ].filter((field): field is string => field !== null);
      await this.writeAudit(transaction, actor, {
        action: input.password !== undefined
          ? 'ADMIN_PASSWORD_RESET'
          : input.isActive !== undefined
            ? 'ADMIN_ACCESS_CHANGED'
            : input.role !== undefined ? 'ADMIN_ROLE_CHANGED' : 'ADMIN_PROFILE_UPDATED',
        targetId: id,
        targetName: updated.name,
        targetEmail: updated.email,
        summary: `Updated administrator account: ${changedFields.join(', ')}.`,
      });
      return updated;
    }, { isolationLevel: 'Serializable' }).catch((error: unknown) => {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('An account with this email already exists.');
      }
      if (isSerializationConflict(error)) {
        throw new ConflictException('This administrator account changed during the update. Refresh and try again.');
      }
      throw error;
    });
  }

  async getSettings() {
    return this.prisma.systemSettings.upsert({
      where: { id: 'global' },
      create: { locationRetentionDays: this.initialRetentionDays() },
      update: {},
    });
  }

  async updateSettings(locationRetentionDays: number, actor: AuditActor) {
    return this.prisma.$transaction(async (transaction) => {
      const settings = await transaction.systemSettings.upsert({
        where: { id: 'global' },
        create: { locationRetentionDays },
        update: { locationRetentionDays },
      });
      await this.writeAudit(transaction, actor, {
        action: 'SETTINGS_UPDATED',
        targetId: settings.id,
        targetName: 'System settings',
        summary: `Set location retention to ${locationRetentionDays} days.`,
      });
      return settings;
    });
  }

  async listAuditLog(page: number, pageSize: number) {
    const [total, entries] = await this.prisma.$transaction([
      this.prisma.adminAuditLog.count(),
      this.prisma.adminAuditLog.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { page, pageSize, total, entries };
  }

  private writeAudit(
    transaction: Prisma.TransactionClient,
    actor: AuditActor,
    entry: {
      action: string;
      targetId?: string;
      targetName: string;
      targetEmail?: string;
      summary: string;
    },
  ) {
    return transaction.adminAuditLog.create({
      data: {
        actorId: actor.id,
        actorName: actor.name,
        actorEmail: actor.email,
        action: entry.action,
        targetId: entry.targetId,
        targetName: entry.targetName,
        targetEmail: entry.targetEmail,
        summary: entry.summary,
      },
    });
  }

  private initialRetentionDays() {
    const days = Number(process.env.LOCATION_RETENTION_DAYS ?? 90);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new Error('LOCATION_RETENTION_DAYS must be a whole number from 1 to 3650.');
    }
    return days;
  }

  async listShifts(
    fromInput: string,
    toInput: string,
    page: number,
    pageSize: number,
    search?: string,
    status: 'all' | 'active' | 'completed' = 'all',
  ) {
    const from = new Date(fromInput);
    const to = new Date(toInput);
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from >= to ||
      to.getTime() - from.getTime() > 32 * 24 * 60 * 60 * 1000
    ) {
      throw new BadRequestException('Provide a valid time range of at most 32 days.');
    }
    const searchTerm = search?.trim();
    const baseWhere = {
      startedAt: { gte: from, lt: to },
      ...(searchTerm
        ? {
            employee: {
              OR: [
                { name: { contains: searchTerm, mode: 'insensitive' as const } },
                { email: { contains: searchTerm, mode: 'insensitive' as const } },
              ],
            },
          }
        : {}),
    };
    const where = {
      ...baseWhere,
      ...(status === 'active' ? { endedAt: null } : {}),
      ...(status === 'completed' ? { endedAt: { not: null } } : {}),
    };
    const [total, activeShifts, shifts] = await this.prisma.$transaction([
      this.prisma.shift.count({ where }),
      this.prisma.shift.count({ where: { startedAt: baseWhere.startedAt, endedAt: null } }),
      this.prisma.shift.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          employee: { select: { id: true, name: true, email: true } },
          samples: {
            orderBy: { capturedAt: 'asc' },
            select: { latitude: true, longitude: true, accuracy: true, capturedAt: true, isMocked: true },
          },
        },
      }),
    ]);
    return {
      page,
      pageSize,
      total,
      activeShifts,
      hasMore: page * pageSize < total,
      shifts: shifts.map((shift) => ({
        id: shift.id,
        employee: shift.employee,
        startedAt: shift.startedAt,
        endedAt: shift.endedAt,
        checkIn: {
          latitude: shift.checkInLat,
          longitude: shift.checkInLng,
          accuracy: shift.checkInAcc,
          isMocked: shift.checkInMocked,
        },
        checkOut: shift.endedAt
          ? {
              latitude: shift.checkOutLat,
              longitude: shift.checkOutLng,
              accuracy: shift.checkOutAcc,
              isMocked: shift.checkOutMocked,
            }
          : null,
        distanceMeters: shift.distanceMeters ?? routeDistance(shift.samples),
        sampleCount: shift.samples.length,
        riskFlags: [
          ...(shift.checkInMocked ? ['check-in reported as mock location'] : []),
          ...(shift.checkOutMocked ? ['check-out reported as mock location'] : []),
          ...(shift.samples.some((sample) => sample.isMocked)
            ? ['one or more route points reported as mock locations']
            : []),
        ],
      })),
    };
  }

  async getRoute(shiftId: string) {
    if (!shiftId) throw new BadRequestException('shiftId is required.');
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: {
        employee: { select: { id: true, name: true } },
        samples: { orderBy: { capturedAt: 'asc' } },
      },
    });
    if (!shift) throw new NotFoundException('Shift not found.');
    const points = shift.samples.map((sample, index, samples) => {
      const previous = samples[index - 1];
      return {
        latitude: sample.latitude,
        longitude: sample.longitude,
        accuracy: sample.accuracy,
        capturedAt: sample.capturedAt,
        isMocked: sample.isMocked,
        segmentDistanceMeters: previous
          ? routeDistance([previous, sample])
          : 0,
      };
    });
    const accuracies = points.map((point) => point.accuracy);
    const gaps = points.slice(1).map((point, index) =>
      (point.capturedAt.getTime() - points[index].capturedAt.getTime()) / 1000,
    );
    const averageAccuracyMeters = accuracies.length
      ? Math.round(accuracies.reduce((sum, accuracy) => sum + accuracy, 0) / accuracies.length)
      : null;
    const maxGapSeconds = gaps.length ? Math.max(...gaps) : 0;
    const significantGapCount = gaps.filter((gap) => gap > 10 * 60).length;
    const limitedCoverage = points.length < 2 ||
      maxGapSeconds > 30 * 60 ||
      (averageAccuracyMeters !== null && averageAccuracyMeters > 70);
    const partialCoverage = !limitedCoverage && (
      maxGapSeconds > 10 * 60 ||
      (averageAccuracyMeters !== null && averageAccuracyMeters > 35)
    );
    return {
      shiftId: shift.id,
      employee: shift.employee,
      startedAt: shift.startedAt,
      endedAt: shift.endedAt,
      startLocation: shift.checkInLat !== null && shift.checkInLng !== null
        ? { latitude: shift.checkInLat, longitude: shift.checkInLng, accuracy: shift.checkInAcc }
        : null,
      endLocation: shift.checkOutLat !== null && shift.checkOutLng !== null
        ? { latitude: shift.checkOutLat, longitude: shift.checkOutLng, accuracy: shift.checkOutAcc }
        : null,
      points,
      distanceMeters: shift.distanceMeters ?? routeDistance(shift.samples),
      quality: {
        coverage: limitedCoverage ? 'limited' : partialCoverage ? 'partial' : 'good',
        pointCount: points.length,
        averageAccuracyMeters,
        maxGapSeconds: Math.round(maxGapSeconds),
        significantGapCount,
        mockedPointCount: points.filter((point) => point.isMocked).length,
        recordedDurationSeconds: points.length > 1
          ? Math.max(0, Math.round(
              (points[points.length - 1].capturedAt.getTime() - points[0].capturedAt.getTime()) / 1000,
            ))
          : 0,
      },
    };
  }
}

function isUniqueConstraintError(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === 'P2002';
}

function isSerializationConflict(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === 'P2034';
}
