import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from 'bcryptjs';
import { PrismaService } from './prisma.service';
import { routeDistance } from './route-distance';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async createEmployee(input: { name: string; email: string; password: string }) {
    return this.createAccount(input, 'EMPLOYEE');
  }

  async createAdmin(input: { name: string; email: string; password: string }) {
    return this.createAccount(input, 'ADMIN');
  }

  private async createAccount(
    input: { name: string; email: string; password: string },
    role: 'ADMIN' | 'EMPLOYEE',
  ) {
    try {
      const user = await this.prisma.user.create({
        data: {
          name: input.name.trim(),
          email: input.email.trim().toLowerCase(),
          passwordHash: await hash(input.password, 12),
          role,
        },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });
      return user;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('An account with this email already exists.');
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
    actorId: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const target = await transaction.user.findUnique({
        where: { id },
        select: { role: true, isActive: true },
      });
      if (!target || (target.role !== 'ADMIN' && target.role !== 'SUPERADMIN')) {
        throw new NotFoundException('Admin account not found.');
      }
      const nextRole = input.role ?? target.role;
      const nextIsActive = input.isActive ?? target.isActive;
      if (id === actorId && (nextRole !== 'SUPERADMIN' || !nextIsActive)) {
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
      return transaction.user.update({
        where: { id },
        data,
        select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
      });
    }, { isolationLevel: 'Serializable' }).catch((error: unknown) => {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('An account with this email already exists.');
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

  updateSettings(locationRetentionDays: number) {
    return this.prisma.systemSettings.upsert({
      where: { id: 'global' },
      create: { locationRetentionDays },
      update: { locationRetentionDays },
    });
  }

  private initialRetentionDays() {
    const days = Number(process.env.LOCATION_RETENTION_DAYS ?? 90);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new Error('LOCATION_RETENTION_DAYS must be a whole number from 1 to 3650.');
    }
    return days;
  }

  async listShifts(fromInput: string, toInput: string, page: number, pageSize: number) {
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
    const where = { startedAt: { gte: from, lt: to } };
    const [total, shifts] = await this.prisma.$transaction([
      this.prisma.shift.count({ where }),
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
    return {
      shiftId: shift.id,
      employee: shift.employee,
      startedAt: shift.startedAt,
      endedAt: shift.endedAt,
      points: shift.samples.map((sample) => ({
        latitude: sample.latitude,
        longitude: sample.longitude,
        accuracy: sample.accuracy,
        capturedAt: sample.capturedAt,
        isMocked: sample.isMocked,
      })),
      distanceMeters: shift.distanceMeters ?? routeDistance(shift.samples),
    };
  }
}

function isUniqueConstraintError(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === 'P2002';
}
