import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useStaticAssets('public');

  const config = new DocumentBuilder()
    .setTitle('Mento Analytics API')
    .setDescription('API for analytics data on the Mento Protocol')
    .setVersion('1.0')
    .addTag('stablecoins')
    .addTag('reserve')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Mento Analytics API Docs',
    customfavIcon: '/favicon.ico',
    customCss: `
      .swagger-ui .topbar { background-color: black; }
      .swagger-ui .topbar-wrapper svg  { display: none !important; }
      .swagger-ui .topbar-wrapper a {
        background-image: url('/logo.svg');
        background-repeat: no-repeat;
        background-position: left center;
        background-size: contain;
        height: 25px;
      }
      .swagger-ui .topbar .download-url-wrapper { display: none; }
    `,
  });
  await app.listen(3000);
}
bootstrap();
