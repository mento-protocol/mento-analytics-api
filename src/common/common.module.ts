import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MentoService } from './services/mento.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  providers: [MentoService],
  exports: [MentoService],
})
export class CommonModule {}
