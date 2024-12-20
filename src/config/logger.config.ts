import { Params } from 'nestjs-pino';
import { ServerResponse, IncomingMessage } from 'http';

interface ResponseWithTime extends ServerResponse {
  responseTime?: number;
}

interface RequestWithProtocol extends IncomingMessage {
  protocol: string;
}

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
      autoLogging: true,
      timestamp: false,
      messageKey: 'message',
      customSuccessMessage: function (req: RequestWithProtocol, res: ResponseWithTime) {
        return `${req.method} ${res.statusCode} ${req.headers['content-length'] || '0'} B 
        ${res.responseTime}ms ${req.protocol} ${req.headers.host}${req.url}`;
      },
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
