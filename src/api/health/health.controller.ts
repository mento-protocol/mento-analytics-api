import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiProperty } from '@nestjs/swagger';
import { MentoService } from '@common/services/mento.service';
import { ConfigService } from '@nestjs/config';

class HealthCheckResponse {
  @ApiProperty({ example: 'ok' })
  status: 'ok' | 'error';

  @ApiProperty({ example: '2024-02-14T12:00:00Z' })
  timestamp: string;

  @ApiProperty({
    example: {
      mentoSdk: { status: 'ok' },
      cache: { status: 'ok' },
      external_apis: { status: 'ok' },
    },
  })
  healthStatuses: {
    mentoSdk: {
      status: 'ok' | 'error';
      details?: string;
    };
    external_apis: {
      status: 'ok' | 'error';
      details?: string;
    };
  };
}

@ApiTags('health')
@Controller('api/v1/health')
export class HealthController {
  EXTERNAL_API_CONFIG = {
    'Blockstream Bitcoin API': 'BLOCKSTREAM_API_URL',
    'Blockchain.info API': 'BLOCKCHAIN_INFO_API_URL',
    'Exchange Rates API': 'EXCHANGE_RATES_API_URL',
    'Celo RPC': 'CELO_RPC_URL',
    'Ethereum RPC': 'ETH_RPC_URL',
  } as const;

  constructor(
    private readonly mentoService: MentoService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Check API health status' })
  @ApiResponse({
    status: 200,
    description: 'Health check response',
    type: HealthCheckResponse,
  })
  async checkHealth(): Promise<HealthCheckResponse> {
    const healthStatuses = {
      mentoSdk: await this.checkMentoSdkConnection(),
      external_apis: await this.checkExternalApis(),
    };

    const hasErrors = Object.values(healthStatuses).some((healthCheck) => healthCheck.status === 'error');

    return {
      status: hasErrors ? 'error' : 'ok',
      timestamp: new Date().toISOString(),
      healthStatuses,
    };
  }

  private async checkMentoSdkConnection() {
    try {
      const mento = this.mentoService.getMentoInstance();
      await mento.getStableTokens();
      return { status: 'ok' as const };
    } catch {
      return {
        status: 'error' as const,
        details: 'Failed to connect to Celo blockchain',
      };
    }
  }

  private async checkExternalApis() {
    const apiConfigs = Object.entries(this.EXTERNAL_API_CONFIG).map(([name, configKey]) => ({
      name,
      url: this.configService.get<string>(configKey),
    }));

    // Just check if the API url is reachable with a simple fetch
    const results = await Promise.allSettled(
      apiConfigs.map(async ({ name, url }) => {
        try {
          await fetch(url);
          return { name, success: true };
        } catch {
          return { name, success: false };
        }
      }),
    );

    const failedApis = results
      .filter((result) => {
        const { value } = result as PromiseFulfilledResult<{ success: boolean }>;
        return !value.success;
      })
      .map((_, index) => apiConfigs[index].name);

    if (failedApis.length === 0) {
      return { status: 'ok' as const };
    }

    return {
      status: 'error' as const,
      details: `Unreachable APIs: ${failedApis.join(', ')}`,
    };
  }
}
