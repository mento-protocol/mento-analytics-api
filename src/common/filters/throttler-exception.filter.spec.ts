import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ThrottlerExceptionFilter } from './throttler-exception.filter';

describe('ThrottlerExceptionFilter', () => {
  let filter: ThrottlerExceptionFilter;
  let mockJson: ReturnType<typeof vi.fn>;
  let mockStatus: ReturnType<typeof vi.fn>;
  let mockHost: ReturnType<typeof createMockHost>;

  const createMockHost = (ip = '127.0.0.1', method = 'GET', url = '/api/v1/health') => {
    mockJson = vi.fn();
    mockStatus = vi.fn().mockReturnValue({ json: mockJson });

    return {
      switchToHttp: vi.fn().mockReturnValue({
        getResponse: vi.fn().mockReturnValue({ status: mockStatus }),
        getRequest: vi.fn().mockReturnValue({ ip, method, url }),
      }),
    };
  };

  beforeEach(() => {
    filter = new ThrottlerExceptionFilter();
    mockHost = createMockHost();
  });

  it('should respond with 429 and a generic message', () => {
    const exception = new ThrottlerException();

    filter.catch(exception, mockHost as any);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(mockJson).toHaveBeenCalledWith({
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message: 'Too Many Requests',
    });
  });

  it('should NOT expose "ThrottlerException" in the response body', () => {
    const exception = new ThrottlerException();

    filter.catch(exception, mockHost as any);

    const responseBody = mockJson.mock.calls[0][0];
    expect(JSON.stringify(responseBody)).not.toContain('ThrottlerException');
  });

  it('should NOT expose "throttl" (case-insensitive) in the response body', () => {
    const exception = new ThrottlerException();

    filter.catch(exception, mockHost as any);

    const responseBody = JSON.stringify(mockJson.mock.calls[0][0]).toLowerCase();
    expect(responseBody).not.toContain('throttl');
  });
});
