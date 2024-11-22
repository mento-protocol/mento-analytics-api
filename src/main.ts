import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('Mento Analytics API')
    .setDescription('API for analytics data on the Mento Protocol')
    .setVersion('1.0')
    .addTag('stablecoins')
    .addTag('reserve')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
  await app.listen(3255);
}
bootstrap();
