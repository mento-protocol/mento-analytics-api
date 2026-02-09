import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Response } from 'express';

/**
 * Catches ThrottlerException and returns a generic 429 response.
 *
 * The default NestJS throttler response exposes "ThrottlerException" in the
 * error body, which leaks implementation details to potential attackers.
 * This filter replaces it with a generic message while still logging the
 * original exception internally.
 */
@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ThrottlerExceptionFilter.name);

  catch(exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    this.logger.warn(`Rate limit exceeded for ${request.ip} on ${request.method} ${request.url}`);

    response.status(HttpStatus.TOO_MANY_REQUESTS).json({
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message: 'Too Many Requests',
    });
  }
}
