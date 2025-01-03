import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import './instrument';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useLogger(app.get(Logger));
  app.useStaticAssets('public');

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
