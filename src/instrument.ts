import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  release: process.env.RELEASE_VERSION || 'unknown',
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
  // Tracing
  tracesSampleRate: 1.0, //  Capture 100% of the transactions
  enabled: process.env.NODE_ENV !== 'development',
  beforeSend(event) {
    // Add release information to all events
    if (process.env.RELEASE_VERSION) {
      event.release = process.env.RELEASE_VERSION;
    }
    return event;
  },
});
