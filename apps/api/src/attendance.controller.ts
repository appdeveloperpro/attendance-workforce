import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthRequest } from './auth.types';
import { AttendanceService } from './attendance.service';
import { CheckOutDto, LocationDto, LocationSampleDto } from './location.dto';
import { JwtGuard } from './auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

class CheckInDto extends LocationDto {}

@UseGuards(JwtGuard, RolesGuard)
@Roles('EMPLOYEE')
@Controller()
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('attendance/current')
  current(@Req() request: AuthRequest) {
    return this.attendanceService.current(request.user.id);
  }

  @Post('attendance/check-in')
  checkIn(@Req() request: AuthRequest, @Body() body: CheckInDto) {
    return this.attendanceService.checkIn(request.user.id, body);
  }

  @Post('attendance/check-out')
  checkOut(@Req() request: AuthRequest, @Body() body: CheckOutDto) {
    return this.attendanceService.checkOut(request.user.id, body);
  }

  @Post('locations')
  @HttpCode(HttpStatus.NO_CONTENT)
  addSample(@Req() request: AuthRequest, @Body() body: LocationSampleDto) {
    return this.attendanceService.addSample(request.user.id, body);
  }
}
