import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  release: process.env.RELEASE_VERSION || 'unknown',
  environment: process.env.NODE_ENV || 'production',
  integrations: [nodeProfilingIntegration()],
  // Tracing
  tracesSampleRate: 1.0, //  Capture 100% of the transactions
  // Set sampling rate for profiling - this is relative to tracesSampleRate
  profilesSampleRate: 1.0,
  enabled: process.env.NODE_ENV !== 'development',
  beforeSend(event) {
    // Add release information to all events
    if (process.env.RELEASE_VERSION) {
      event.release = process.env.RELEASE_VERSION;
    }
    return event;
  },
});
