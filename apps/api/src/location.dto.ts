import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class LocationDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10000)
  accuracy!: number;

  @IsOptional()
  @IsBoolean()
  isMocked?: boolean;
}

export class LocationSampleDto extends LocationDto {
  @IsString()
  shiftId!: string;

  @IsDateString()
  capturedAt!: string;
}

export class CheckOutDto extends LocationDto {}
