import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { JwtGuard } from './auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { AdminService } from './admin.service';
import { AuthRequest } from './auth.types';

class CreateEmployeeDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;
}

class ShiftQueryDto {
  @IsString()
  from!: string;

  @IsString()
  to!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(120)
  search?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['all', 'active', 'completed'])
  status: 'all' | 'active' | 'completed' = 'all';
}

class AuditQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;
}

class UpdateAdminDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['SUPERADMIN', 'ADMIN'])
  role?: 'SUPERADMIN' | 'ADMIN';

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsEmail()
  email?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(12)
  password?: string;
}

class UpdateEmployeeDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsEmail()
  email?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(12)
  password?: string;
}

class RetentionSettingsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  locationRetentionDays!: number;
}

@UseGuards(JwtGuard, RolesGuard)
@Roles('ADMIN', 'SUPERADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('employees')
  createEmployee(@Body() body: CreateEmployeeDto, @Req() request: AuthRequest) {
    return this.adminService.createEmployee(body, request.user);
  }

  @Get('employees')
  employees() {
    return this.adminService.listEmployees();
  }

  @Patch('employees/:id')
  updateEmployee(
    @Param('id') id: string,
    @Body() body: UpdateEmployeeDto,
    @Req() request: AuthRequest,
  ) {
    return this.adminService.updateEmployee(id, body, request.user);
  }

  @Get('admins')
  @Roles('SUPERADMIN')
  admins() {
    return this.adminService.listAdmins();
  }

  @Post('admins')
  @Roles('SUPERADMIN')
  createAdmin(@Body() body: CreateEmployeeDto, @Req() request: AuthRequest) {
    return this.adminService.createAdmin(body, request.user);
  }

  @Patch('admins/:id')
  @Roles('SUPERADMIN')
  updateAdmin(
    @Param('id') id: string,
    @Body() body: UpdateAdminDto,
    @Req() request: AuthRequest,
  ) {
    return this.adminService.updateAdmin(id, body, request.user);
  }

  @Get('audit')
  @Roles('SUPERADMIN')
  audit(@Query() query: AuditQueryDto) {
    return this.adminService.listAuditLog(query.page, query.pageSize);
  }

  @Get('settings')
  @Roles('SUPERADMIN')
  settings() {
    return this.adminService.getSettings();
  }

  @Patch('settings')
  @Roles('SUPERADMIN')
  updateSettings(@Body() body: RetentionSettingsDto, @Req() request: AuthRequest) {
    return this.adminService.updateSettings(body.locationRetentionDays, request.user);
  }

  @Get('shifts')
  shifts(@Query() query: ShiftQueryDto) {
    return this.adminService.listShifts(
      query.from,
      query.to,
      query.page,
      query.pageSize,
      query.search,
      query.status,
    );
  }

  @Get('shifts/route')
  route(@Query('shiftId') shiftId: string) {
    return this.adminService.getRoute(shiftId);
  }
}
