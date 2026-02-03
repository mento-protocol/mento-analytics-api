import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HealthController } from './health.controller';
import { MentoService } from '@common/services/mento.service';
import { CACHE_KEYS } from '@common/constants';

describe('HealthController', () => {
  let controller: HealthController;
  let cacheManager: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  let mentoService: { getMentoInstance: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    cacheManager = {
      get: vi.fn(),
      set: vi.fn(),
    };

    mentoService = {
      getMentoInstance: vi.fn().mockReturnValue({
        getStableTokens: vi.fn().mockResolvedValue([]),
      }),
    };

    configService = {
      get: vi.fn().mockImplementation((key: string) => {
        const config: Record<string, string> = {
          BLOCKSTREAM_API_URL: 'https://blockstream.info/api',
          BLOCKCHAIN_INFO_API_URL: 'https://blockchain.info',
          EXCHANGE_RATES_API_URL: 'https://api.exchangerate.host',
          CELO_RPC_URL: 'https://forno.celo.org',
          ETH_RPC_URL: 'https://eth.llamarpc.com',
          SENTRY_DSN: 'https://test@sentry.io/123',
          RELEASE_VERSION: '1.0.0',
          SENTRY_ENVIRONMENT: 'test',
        };
        return config[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: MentoService, useValue: mentoService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('checkHealth', () => {
    it('should return cached response when available', async () => {
      const cachedResponse = {
        status: 'ok' as const,
        timestamp: '2024-01-01T00:00:00.000Z',
        healthStatuses: {
          mentoSdk: { status: 'ok' as const },
          external_apis: { status: 'ok' as const },
          sentry: { status: 'ok' as const, release: '1.0.0', environment: 'test' },
        },
      };

      cacheManager.get.mockResolvedValue(cachedResponse);

      const result = await controller.checkHealth();

      expect(result).toEqual(cachedResponse);
      expect(cacheManager.get).toHaveBeenCalledWith(CACHE_KEYS.HEALTH);
      // Should NOT call external services when cache hit
      expect(mentoService.getMentoInstance).not.toHaveBeenCalled();
    });

    it('should fetch fresh data and cache it when cache is empty', async () => {
      cacheManager.get.mockResolvedValue(null);

      // Mock fetch for external API checks
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      const result = await controller.checkHealth();

      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
      expect(result.healthStatuses).toBeDefined();

      // Should cache the result
      expect(cacheManager.set).toHaveBeenCalledWith(
        CACHE_KEYS.HEALTH,
        expect.objectContaining({ status: 'ok' }),
        30 * 1000, // 30 second TTL
      );

      // Should have called MentoService
      expect(mentoService.getMentoInstance).toHaveBeenCalled();
    });

    it('should not call cache.set when returning cached response', async () => {
      const cachedResponse = {
        status: 'ok' as const,
        timestamp: '2024-01-01T00:00:00.000Z',
        healthStatuses: {
          mentoSdk: { status: 'ok' as const },
          external_apis: { status: 'ok' as const },
          sentry: { status: 'ok' as const },
        },
      };

      cacheManager.get.mockResolvedValue(cachedResponse);

      await controller.checkHealth();

      expect(cacheManager.set).not.toHaveBeenCalled();
    });
  });
});
