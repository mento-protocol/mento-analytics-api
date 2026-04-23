import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export interface DataWarning {
  source: string;
  message: string;
  cached_since?: string;
}

export class V2DataWarningDto {
  @ApiProperty({ description: 'Which data source is affected' })
  source: string;

  @ApiProperty({ description: 'Human-readable description of the issue' })
  message: string;

  @ApiPropertyOptional({ description: 'ISO-8601 timestamp of the cached data being used' })
  cached_since?: string;
}

export class V2MetaDto {
  @ApiProperty({ description: 'ISO-8601 timestamp of when this response was computed' })
  timestamp: string;

  @ApiPropertyOptional({
    type: [V2DataWarningDto],
    description: 'Present when some data sources are stale or unavailable',
  })
  warnings?: V2DataWarningDto[];
}

/**
 * Build a V2MetaDto from a list of warnings. Returns undefined if there are
 * no warnings, so the field is omitted from JSON serialization.
 */
export function buildMeta(warnings: DataWarning[]): V2MetaDto | undefined {
  if (warnings.length === 0) return undefined;
  return {
    timestamp: new Date().toISOString(),
    warnings: warnings.map((w) => ({
      source: w.source,
      message: w.message,
      cached_since: w.cached_since,
    })),
  };
}
