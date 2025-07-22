import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import './instrument';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useLogger(app.get(Logger));
  app.useStaticAssets('public');

  // Configure CORS - More secure configuration for analytics API
  const allowedOrigins = [
    'https://mento.org',
    'https://www.mento.org',
    'https://mento-analytics-api-12390052758.us-central1.run.app',
  ];

  // Add localhost for development if NODE_ENV is development
  if (process.env.NODE_ENV === 'development') {
    allowedOrigins.push(`http://localhost:${process.env.PORT || 8080}`);
  }

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-side requests, Postman, etc.)
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS policy`), false);
      }
    },
    // Only allow methods actually used by the API (all endpoints are GET)
    methods: ['GET', 'HEAD', 'OPTIONS'],
    // Disable credentials since this is a public analytics API
    credentials: false,
    preflightContinue: false,
    optionsSuccessStatus: 204,
    // Minimal headers needed for a read-only API
    allowedHeaders: ['Content-Type', 'Accept', 'User-Agent', 'Cache-Control'],
    // Headers that can be exposed to the client
    exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Per-Page', 'Cache-Control'],
    // Cache preflight requests for 24 hours
    maxAge: 86400,
  });

  const config = new DocumentBuilder()
    .setTitle('Mento Analytics API')
    .setDescription('API for analytics data on the Mento Protocol')
    .setVersion('1.0')
    .addTag('stablecoins')
    .addTag('reserve')
    .addTag('health')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Mento Analytics API Docs',
    customfavIcon:
      'https://raw.githubusercontent.com/mento-protocol/mento-analytics-api/refs/heads/main/public/favicon.ico',
    customCss: `
      .swagger-ui .topbar { background-color: black; }
      .swagger-ui .topbar-wrapper svg  { display: none !important; }
      .swagger-ui .topbar-wrapper a {
        background-image: url('https://raw.githubusercontent.com/mento-protocol/mento-analytics-api/refs/heads/main/public/logo.svg');
        background-repeat: no-repeat;
        background-position: left center;
        background-size: contain;
        height: 25px;
      }
      .swagger-ui .topbar .download-url-wrapper { display: none; }
    `,
  });
  await app.listen(process.env.PORT || 8080);
}
bootstrap();
