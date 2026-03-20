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
  IsBoolean,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { CampaignStatus } from '@prisma/client';

// Transformer para converter arrays vazios em objetos vazios
export function TransformArrayToObject() {
  return Transform(({ value }) => {
    if (Array.isArray(value) && value.length === 0) {
      return {};
    }
    return value;
  });
}

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
  startDate?: string | null;

  @IsDateString()
  @IsOptional()
  scheduledAt?: string | null;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(1000)
  batchSize?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  delayBetweenBatches?: number;

  @IsArray()
  @IsOptional()
  timeWindows?: Array<{
    templateName: string;
    category: string;
    startTime: string;
    endTime: string;
  }>;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch { return {}; }
    }
    if (Array.isArray(value) && value.length === 0) return {};
    return value;
  })
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
  startDate?: string | null;

  @IsDateString()
  @IsOptional()
  scheduledAt?: string | null;

  @IsNumber()
  @IsOptional()
  @Min(1)
  batchSize?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
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

  @TransformArrayToObject()
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

export class CreateContactDto {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @TransformArrayToObject()
  @IsObject()
  @IsOptional()
  variables?: Record<string, any>;

  @IsObject()
  @IsOptional()
  metadata?: any;
}

export class AddContactsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateContactDto)
  contacts: CreateContactDto[];

  @IsNumber()
  @IsOptional()
  @Min(1)
  contacts_count?: number;
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

// ==================== MANUAL WEBHOOK TRIGGER ====================

export class TriggerBroadcastUpdateDto {
  @IsEnum(CampaignStatus)
  @IsOptional()
  status?: CampaignStatus;

  @IsBoolean()
  @IsOptional()
  sendStatusEvent?: boolean;

  @IsNumber()
  @IsOptional()
  @Min(0)
  totalContacts?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  sentContacts?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  deliveredContacts?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  readContacts?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  failedContacts?: number;

  @IsNumber()
  @IsOptional()
  statusCode?: number;

  @IsString()
  @IsOptional()
  link?: string;

  @IsString()
  @IsOptional()
  error?: string;
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
    responded: number;
    optedOut: number;
  };
  rates: {
    success: string;
    delivery: string;
    read: string;
    failure: string;
    response: string;
    optOut: string;
  };
  responseTimes: {
    averageSeconds: number;
    averageMinutes: number;
    averageHumanized: string;
  };
  engagement: {
    buttonClicks: {
      total: number;
      uniqueContacts: number;
      rate: string;
    };
    hourlyDistribution: Array<{
      hour: number;
      responses: number;
      reads: number;
      engagementScore: number;
    }>;
    bestHours: Array<{
      hour: number;
      responses: number;
      reads: number;
      engagementScore: number;
    }>;
  };
}
