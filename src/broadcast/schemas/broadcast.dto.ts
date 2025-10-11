import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  IsObject,
  IsDateString,
  IsNotEmpty,
  ValidateNested,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CampaignStatus } from '@prisma/client';

// ==================== CREATE CAMPAIGN ====================

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  templateId?: string; // ID do template (identificador único) - será gerado se não fornecido

  @IsObject()
  @IsNotEmpty()
  template: any; // Dados completos do template

  @IsString()
  @IsOptional()
  channel?: string;

  @IsString()
  @IsOptional()
  phoneNumberId?: string;

  @IsDateString()
  @IsOptional()
  scheduledAt?: Date;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(1000)
  batchSize?: number;

  @IsNumber()
  @IsOptional()
  @Min(1000)
  delayBetweenBatches?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsObject()
  @IsOptional()
  metadata?: any;
}

// ==================== UPDATE CAMPAIGN ====================

export class UpdateCampaignDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDateString()
  @IsOptional()
  scheduledAt?: Date;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(1000)
  batchSize?: number;

  @IsNumber()
  @IsOptional()
  @Min(1000)
  delayBetweenBatches?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsObject()
  @IsOptional()
  metadata?: any;
}

// ==================== ADD RECIPIENTS ====================

export class RecipientDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsObject()
  @IsOptional()
  variables?: Record<string, string>;

  @IsObject()
  @IsOptional()
  metadata?: any;
}

export class AddRecipientsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipientDto)
  recipients: RecipientDto[];
}

// ==================== QUERY FILTERS ====================

export class CampaignFilterDto {
  @IsEnum(CampaignStatus)
  @IsOptional()
  status?: CampaignStatus;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  @Min(1)
  page?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100)
  limit?: number;
}

// ==================== RESPONSE DTOS ====================

export class CampaignStatsDto {
  campaign: {
    id: string;
    name: string;
    status: string;
    startedAt: Date | null;
    completedAt: Date | null;
  };
  stats: {
    totalRecipients: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    pending: number;
  };
  rates: {
    success: string;
    delivery: string;
    read: string;
    failure: string;
  };
}
