import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HealthController, HEALTH_CACHE_TTL } from './health.controller';
import { MentoService } from '@common/services/mento.service';
import { CACHE_KEYS } from '@common/constants';

// Hoist the Sentry mock so it's available when vi.mock factory runs
const { mockCaptureMessage } = vi.hoisted(() => ({
  mockCaptureMessage: vi.fn().mockReturnValue('test-event-id'),
}));

vi.mock('@sentry/nestjs', () => ({
  captureMessage: mockCaptureMessage,
}));

describe('HealthController', () => {
  let controller: HealthController;
  let cacheManager: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  let mentoService: { getMentoInstance: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };

  const defaultConfig: Record<string, string> = {
    BLOCKSTREAM_API_URL: 'https://blockstream.info/api',
    BLOCKCHAIN_INFO_API_URL: 'https://blockchain.info',
    EXCHANGE_RATES_API_URL: 'https://api.exchangerate.host',
    CELO_RPC_URL: 'https://forno.celo.org',
    ETH_RPC_URL: 'https://eth.llamarpc.com',
    SENTRY_DSN: 'https://test@sentry.io/123',
    RELEASE_VERSION: '1.0.0',
    SENTRY_ENVIRONMENT: 'test',
  };

  beforeEach(async () => {
    // Reset Sentry mock to default success behavior
    mockCaptureMessage.mockReset().mockReturnValue('test-event-id');

    // Default fetch mock — all HTTP APIs reachable
    global.fetch = vi.fn().mockResolvedValue({ ok: true });

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
      get: vi.fn().mockImplementation((key: string) => defaultConfig[key]),
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

  // ---------------------------------------------------------------------------
  // Cache behaviour
  // ---------------------------------------------------------------------------
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
        HEALTH_CACHE_TTL, // 30 second TTL
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

  // ---------------------------------------------------------------------------
  // Mento SDK connection check
  // ---------------------------------------------------------------------------
  describe('checkMentoSdkConnection (via checkHealth)', () => {
    beforeEach(() => {
      cacheManager.get.mockResolvedValue(null);
    });

    it('should return mentoSdk error when getMentoInstance throws', async () => {
      mentoService.getMentoInstance.mockImplementation(() => {
        throw new Error('SDK not initialized');
      });

      const result = await controller.checkHealth();

      expect(result.healthStatuses.mentoSdk).toEqual({
        status: 'error',
        details: 'Failed to connect to Celo blockchain',
      });
    });

    it('should return mentoSdk error when getStableTokens rejects', async () => {
      mentoService.getMentoInstance.mockReturnValue({
        getStableTokens: vi.fn().mockRejectedValue(new Error('Network error')),
      });

      const result = await controller.checkHealth();

      expect(result.healthStatuses.mentoSdk).toEqual({
        status: 'error',
        details: 'Failed to connect to Celo blockchain',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // External API checks
  // ---------------------------------------------------------------------------
  describe('checkExternalApis (via checkHealth)', () => {
    beforeEach(() => {
      cacheManager.get.mockResolvedValue(null);
    });

    it('should return ok when all HTTP APIs are reachable', async () => {
      const result = await controller.checkHealth();

      expect(result.healthStatuses.external_apis).toEqual({ status: 'ok' });
    });

    it('should return error with failed API names when some HTTP APIs fail', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url === 'https://blockstream.info/api') {
          return Promise.reject(new Error('Connection refused'));
        }
        return Promise.resolve({ ok: true });
      });

      const result = await controller.checkHealth();

      expect(result.healthStatuses.external_apis.status).toBe('error');
      expect(result.healthStatuses.external_apis.details).toContain('Blockstream Bitcoin API');
      // Other APIs should NOT be listed
      expect(result.healthStatuses.external_apis.details).not.toContain('Blockchain.info API');
    });

    it('should list all failed API names when all HTTP APIs are unreachable', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await controller.checkHealth();

      expect(result.healthStatuses.external_apis.status).toBe('error');
      const details = result.healthStatuses.external_apis.details!;
      expect(details).toContain('Blockstream Bitcoin API');
      expect(details).toContain('Blockchain.info API');
      expect(details).toContain('Exchange Rates API');
      expect(details).toContain('Celo RPC');
      expect(details).toContain('Ethereum RPC');
    });

    it('should route wss:// URLs through WebSocket connection check', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'CELO_RPC_URL') return 'wss://forno.celo.org/ws';
        return defaultConfig[key];
      });

      vi.spyOn(controller as never, 'checkWebSocketConnection' as never).mockResolvedValue(true as never);

      const result = await controller.checkHealth();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((controller as any).checkWebSocketConnection).toHaveBeenCalledWith('wss://forno.celo.org/ws');
      expect(result.healthStatuses.external_apis).toEqual({ status: 'ok' });
    });

    it('should route ws:// URLs through WebSocket connection check', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'ETH_RPC_URL') return 'ws://localhost:8545';
        return defaultConfig[key];
      });

      vi.spyOn(controller as never, 'checkWebSocketConnection' as never).mockResolvedValue(true as never);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((controller as any).checkWebSocketConnection).not.toHaveBeenCalled();

      await controller.checkHealth();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((controller as any).checkWebSocketConnection).toHaveBeenCalledWith('ws://localhost:8545');
    });

    it('should report error when WebSocket connection fails', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'CELO_RPC_URL') return 'wss://forno.celo.org/ws';
        return defaultConfig[key];
      });

      vi.spyOn(controller as never, 'checkWebSocketConnection' as never).mockResolvedValue(false as never);

      const result = await controller.checkHealth();

      expect(result.healthStatuses.external_apis.status).toBe('error');
      expect(result.healthStatuses.external_apis.details).toContain('Celo RPC');
    });
  });

  // ---------------------------------------------------------------------------
  // Sentry health check
  // ---------------------------------------------------------------------------
  describe('checkSentryHealth (via checkHealth)', () => {
    beforeEach(() => {
      cacheManager.get.mockResolvedValue(null);
    });

    it('should return sentry ok with release and environment', async () => {
      const result = await controller.checkHealth();

      expect(result.healthStatuses.sentry).toEqual({
        status: 'ok',
        release: '1.0.0',
        environment: 'test',
      });
    });

    it('should return error when SENTRY_DSN is not configured', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'SENTRY_DSN') return undefined;
        return defaultConfig[key];
      });

      const result = await controller.checkHealth();

      expect(result.healthStatuses.sentry).toEqual({
        status: 'error',
        details: 'SENTRY_DSN not configured',
      });
    });

    it('should return error when captureMessage returns falsy', async () => {
      mockCaptureMessage.mockReturnValue(undefined);

      const result = await controller.checkHealth();

      expect(result.healthStatuses.sentry).toEqual({
        status: 'error',
        details: 'Failed to capture test event to Sentry',
      });
    });

    it('should return error with message when captureMessage throws an Error', async () => {
      mockCaptureMessage.mockImplementation(() => {
        throw new Error('Sentry transport error');
      });

      const result = await controller.checkHealth();

      expect(result.healthStatuses.sentry.status).toBe('error');
      expect(result.healthStatuses.sentry.details).toContain('Sentry transport error');
    });

    it('should return "Unknown error" for non-Error exceptions in Sentry check', async () => {
      mockCaptureMessage.mockImplementation(() => {
        throw 'string error'; // eslint-disable-line no-throw-literal
      });

      const result = await controller.checkHealth();

      expect(result.healthStatuses.sentry.status).toBe('error');
      expect(result.healthStatuses.sentry.details).toContain('Unknown error');
    });

    it('should fall back to NODE_ENV when SENTRY_ENVIRONMENT is not set', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'SENTRY_ENVIRONMENT') return undefined;
        if (key === 'NODE_ENV') return 'staging';
        return defaultConfig[key];
      });

      const result = await controller.checkHealth();

      expect(result.healthStatuses.sentry).toEqual(
        expect.objectContaining({
          status: 'ok',
          environment: 'staging',
        }),
      );
    });

    it('should default to "production" when neither SENTRY_ENVIRONMENT nor NODE_ENV is set', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'SENTRY_ENVIRONMENT') return undefined;
        if (key === 'NODE_ENV') return undefined;
        return defaultConfig[key];
      });

      const result = await controller.checkHealth();

      expect(result.healthStatuses.sentry).toEqual(
        expect.objectContaining({
          status: 'ok',
          environment: 'production',
        }),
      );
    });

    it('should use "unknown" for release when RELEASE_VERSION is not set', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'RELEASE_VERSION') return undefined;
        return defaultConfig[key];
      });

      const result = await controller.checkHealth();

      expect(result.healthStatuses.sentry).toEqual(
        expect.objectContaining({
          status: 'ok',
          release: 'unknown',
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Overall status aggregation
  // ---------------------------------------------------------------------------
  describe('overall status aggregation', () => {
    beforeEach(() => {
      cacheManager.get.mockResolvedValue(null);
    });

    it('should return ok status when all checks pass', async () => {
      const result = await controller.checkHealth();

      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
    });

    it('should return error status when mentoSdk check fails', async () => {
      mentoService.getMentoInstance.mockImplementation(() => {
        throw new Error('SDK error');
      });

      const result = await controller.checkHealth();

      expect(result.status).toBe('error');
    });

    it('should return error status when external_apis check fails', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('All APIs down'));

      const result = await controller.checkHealth();

      expect(result.status).toBe('error');
    });

    it('should return error status when sentry check fails', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'SENTRY_DSN') return undefined;
        return defaultConfig[key];
      });

      const result = await controller.checkHealth();

      expect(result.status).toBe('error');
    });

    it('should still cache error responses', async () => {
      mentoService.getMentoInstance.mockImplementation(() => {
        throw new Error('SDK error');
      });

      await controller.checkHealth();

      expect(cacheManager.set).toHaveBeenCalledWith(
        CACHE_KEYS.HEALTH,
        expect.objectContaining({ status: 'error' }),
        HEALTH_CACHE_TTL,
      );
    });

    it('should include a valid ISO timestamp', async () => {
      const result = await controller.checkHealth();

      expect(() => new Date(result.timestamp)).not.toThrow();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });
});
