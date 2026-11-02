import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtGuard } from './auth.guard';
import { PrismaService } from './prisma.service';
import { RetentionService } from './retention.service';

@Module({
  controllers: [AppController, AuthController, AttendanceController, AdminController],
  providers: [
    AppService,
    AuthService,
    AttendanceService,
    AdminService,
    PrismaService,
    RetentionService,
    JwtGuard,
  ],
})
export class AppModule {}
