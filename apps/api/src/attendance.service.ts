import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { LocationDto, LocationSampleDto } from './location.dto';
import { routeDistance } from './route-distance';

const MAX_CHECK_IN_ACCURACY_METERS = 100;
const MAX_DELAYED_SAMPLE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  async current(employeeId: string) {
    const shift = await this.prisma.shift.findFirst({
      where: { employeeId, endedAt: null },
      orderBy: { startedAt: 'desc' },
      select: { id: true, startedAt: true },
    });
    return { shift };
  }

  async checkIn(employeeId: string, location: LocationDto) {
    if (location.accuracy > MAX_CHECK_IN_ACCURACY_METERS) {
      throw new BadRequestException(
        'Location accuracy is too low. Wait for a more accurate GPS fix and try again.',
      );
    }
    try {
      const shift = await this.prisma.shift.create({
        data: {
          employeeId,
          activeEmployeeId: employeeId,
          checkInLat: location.latitude,
          checkInLng: location.longitude,
          checkInAcc: location.accuracy,
          checkInMocked: location.isMocked ?? false,
          samples: {
            create: {
              latitude: location.latitude,
              longitude: location.longitude,
              accuracy: location.accuracy,
              isMocked: location.isMocked ?? false,
              capturedAt: new Date(),
            },
          },
        },
        select: { id: true, startedAt: true },
      });
      return { shiftId: shift.id, startedAt: shift.startedAt };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('You already have an active shift.');
      }
      throw error;
    }
  }

  async checkOut(employeeId: string, location: LocationDto) {
    if (location.accuracy > MAX_CHECK_IN_ACCURACY_METERS) {
      throw new BadRequestException(
        'Location accuracy is too low. Wait for a more accurate GPS fix and try again.',
      );
    }
    const shift = await this.prisma.shift.findFirst({
      where: { employeeId, endedAt: null },
      select: { id: true, startedAt: true },
    });
    if (!shift) throw new NotFoundException('There is no active shift to check out.');
    const endedAt = new Date();
    const updated = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.shift.updateMany({
        where: { id: shift.id, employeeId, endedAt: null, activeEmployeeId: employeeId },
        data: {
          endedAt,
          activeEmployeeId: null,
          checkOutLat: location.latitude,
          checkOutLng: location.longitude,
          checkOutAcc: location.accuracy,
          checkOutMocked: location.isMocked ?? false,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException('This shift has already been checked out.');
      }
      const lastSample = await transaction.locationSample.findFirst({
        where: { shiftId: shift.id },
        orderBy: { capturedAt: 'desc' },
        select: { capturedAt: true },
      });
      if (!lastSample || lastSample.capturedAt < endedAt) {
        await transaction.locationSample.create({
          data: {
            shiftId: shift.id,
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy,
            isMocked: location.isMocked ?? false,
            capturedAt: endedAt,
          },
        });
      }
      const samples = await transaction.locationSample.findMany({
        where: { shiftId: shift.id },
        orderBy: { capturedAt: 'asc' },
        select: { latitude: true, longitude: true, accuracy: true, capturedAt: true },
      });
      const distanceMeters = routeDistance(samples);
      const updatedShift = await transaction.shift.update({
        where: { id: shift.id },
        data: { distanceMeters },
        select: { id: true, endedAt: true },
      });
      return { ...updatedShift, distanceMeters };
    });
    return {
      shiftId: updated.id,
      endedAt: updated.endedAt,
      distanceMeters: updated.distanceMeters,
    };
  }

  async addSample(employeeId: string, sample: LocationSampleDto): Promise<void> {
    if (sample.accuracy > MAX_CHECK_IN_ACCURACY_METERS) {
      throw new BadRequestException('Location accuracy is too low to record this sample.');
    }
    const capturedAt = new Date(sample.capturedAt);
    const now = Date.now();
    const time = capturedAt.getTime();
    if (time < now - MAX_DELAYED_SAMPLE_AGE_MS || time > now + MAX_FUTURE_SKEW_MS) {
      throw new BadRequestException('Location timestamp is outside the accepted upload window.');
    }
    try {
      await this.prisma.$transaction(async (transaction) => {
        const shifts = await transaction.$queryRaw<Array<{ id: string; endedAt: Date | null }>>`
          SELECT "id", "endedAt"
          FROM "Shift"
          WHERE "employeeId" = ${employeeId}
            AND "id" = ${sample.shiftId}
            AND "startedAt" <= ${capturedAt}
            AND (
              "activeEmployeeId" = ${employeeId}
              OR (
                "endedAt" >= ${capturedAt}
                AND "endedAt" >= ${new Date(now - MAX_DELAYED_SAMPLE_AGE_MS)}
              )
            )
          FOR UPDATE
        `;
        const shift = shifts[0];
        if (!shift) {
          throw new ConflictException('Location can only be recorded during an active shift.');
        }
        await transaction.locationSample.create({
          data: {
            shiftId: shift.id,
            latitude: sample.latitude,
            longitude: sample.longitude,
            accuracy: sample.accuracy,
            isMocked: sample.isMocked ?? false,
            capturedAt,
          },
        });
        if (shift.endedAt) {
          const samples = await transaction.locationSample.findMany({
            where: { shiftId: shift.id },
            orderBy: { capturedAt: 'asc' },
            select: { latitude: true, longitude: true, accuracy: true, capturedAt: true },
          });
          await transaction.shift.update({
            where: { id: shift.id },
            data: { distanceMeters: routeDistance(samples) },
          });
        }
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return;
      throw error;
    }
  }
}

function isUniqueConstraintError(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === 'P2002';
}
