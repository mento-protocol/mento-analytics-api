import { Params } from 'nestjs-pino';

export function getLocalPinoConfig(): Params {
  return {
    pinoHttp: {
      transport: {
        target: 'pino-pretty',
        options: {
          singleLine: true,
        },
      },
    },
  };
}

export function getProductionPinoConfig(): Params {
  return {
    pinoHttp: {
      autoLogging: false,
      timestamp: false,
      messageKey: 'message',
      formatters: {
        level(label) {
          const severityMap = {
            trace: 'DEBUG',
            debug: 'DEBUG',
            info: 'INFO',
            warn: 'WARNING',
            error: 'ERROR',
            fatal: 'CRITICAL',
          };
          return { severity: severityMap[label] || 'DEFAULT' };
        },
      },
    },
  };
}
