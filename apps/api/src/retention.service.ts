import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { routeDistance } from './route-distance';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private timer: NodeJS.Timeout | undefined;
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.scheduleNextRun();
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleNextRun() {
    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setUTCHours(2, 0, 0, 0);
    if (nextRun <= now) nextRun.setUTCDate(nextRun.getUTCDate() + 1);
    this.timer = setTimeout(() => {
      this.scheduleNextRun();
      void this.removeExpiredLocations();
    }, nextRun.getTime() - now.getTime());
  }

  private async removeExpiredLocations() {
    try {
      const settings = await this.prisma.systemSettings.upsert({
        where: { id: 'global' },
        create: { locationRetentionDays: this.initialRetentionDays() },
        update: {},
      });
      const cutoff = new Date(Date.now() - settings.locationRetentionDays * DAY_MS);
      const [sampleCount, shiftCount] = await this.prisma.$transaction(async (transaction) => {
        const expiredShifts = await transaction.shift.findMany({
          where: { endedAt: { lt: cutoff }, distanceMeters: null },
          select: {
            id: true,
            distanceMeters: true,
            samples: {
              select: {
                latitude: true,
                longitude: true,
                accuracy: true,
                capturedAt: true,
              },
            },
          },
        });
        for (const shift of expiredShifts) {
          await transaction.shift.update({
            where: { id: shift.id },
            data: { distanceMeters: routeDistance(shift.samples) },
          });
        }
        const samples = await transaction.locationSample.deleteMany({
          where: {
            OR: [
              { capturedAt: { lt: cutoff } },
              { shift: { is: { endedAt: { lt: cutoff } } } },
            ],
          },
        });
        const shifts = await transaction.shift.updateMany({
          where: { endedAt: { lt: cutoff } },
          data: {
            checkInLat: null,
            checkInLng: null,
            checkInAcc: null,
            checkInMocked: false,
            checkOutLat: null,
            checkOutLng: null,
            checkOutAcc: null,
            checkOutMocked: null,
          },
        });
        return [samples.count, shifts.count] as const;
      });
      this.logger.log(
        `Location retention completed: removed ${sampleCount} samples and cleared coordinates for ${shiftCount} shifts.`,
      );
    } catch (error) {
      this.logger.error(
        'Location retention cleanup failed.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private initialRetentionDays() {
    const configured = Number(process.env.LOCATION_RETENTION_DAYS ?? 90);
    if (!Number.isInteger(configured) || configured < 1 || configured > 3650) {
      throw new Error('LOCATION_RETENTION_DAYS must be a whole number from 1 to 3650.');
    }
    return configured;
  }
}
