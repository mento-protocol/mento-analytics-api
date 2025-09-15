import { MentoService } from '@common/services/mento.service';
import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import * as Sentry from '@sentry/nestjs';
import * as WebSocket from 'ws';

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
      sentry: { status: 'ok' },
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
    sentry: {
      status: 'ok' | 'error';
      details?: string;
      release?: string;
      environment?: string;
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
      sentry: await this.checkSentryHealth(),
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

  private isWebSocketUrl(url: string): boolean {
    return url.startsWith('ws://') || url.startsWith('wss://');
  }

  private async checkWebSocketConnection(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const ws = new WebSocket(url);
      const timeout = setTimeout(() => {
        ws.terminate();
        resolve(false);
      }, 5000); // 5 second timeout

      ws.on('open', () => {
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      });

      ws.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }

  private async checkExternalApis() {
    const apiConfigs = Object.entries(this.EXTERNAL_API_CONFIG).map(([name, configKey]) => ({
      name,
      url: this.configService.get<string>(configKey),
    }));

    const results = await Promise.allSettled(
      apiConfigs.map(async ({ name, url }) => {
        try {
          if (this.isWebSocketUrl(url)) {
            const isConnected = await this.checkWebSocketConnection(url);
            return { name, success: isConnected };
          } else {
            await fetch(url);
            return { name, success: true };
          }
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
      .map((result: PromiseFulfilledResult<{ name: string; success: boolean }>) => result.value.name);

    if (failedApis.length === 0) {
      return { status: 'ok' as const };
    }

    return {
      status: 'error' as const,
      details: `Unreachable APIs: ${failedApis.join(', ')}`,
    };
  }

  private async checkSentryHealth() {
    try {
      // Check if Sentry is properly configured
      const dsn = this.configService.get<string>('SENTRY_DSN');
      const release = this.configService.get<string>('RELEASE_VERSION');
      const environment =
        this.configService.get<string>('SENTRY_ENVIRONMENT') ||
        this.configService.get<string>('NODE_ENV') ||
        'production';

      if (!dsn) {
        return {
          status: 'error' as const,
          details: 'SENTRY_DSN not configured',
        };
      }

      // Test Sentry by capturing a test event (this is safe and won't spam Sentry)
      const testEventId = Sentry.captureMessage('Health check test event', 'info');

      if (!testEventId) {
        return {
          status: 'error' as const,
          details: 'Failed to capture test event to Sentry',
        };
      }

      return {
        status: 'ok' as const,
        release: release || 'unknown',
        environment,
      };
    } catch (error) {
      return {
        status: 'error' as const,
        details: `Sentry health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}
