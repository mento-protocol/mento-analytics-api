import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { StablecoinsService } from './stablecoins.service';
import { StablecoinsResponseDto } from './dto/stablecoin.dto';

@ApiTags('stablecoins')
@Controller('api/v1/stablecoins')
export class StablecoinsController {
  constructor(private readonly stablecoinsService: StablecoinsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all stablecoins' })
  @ApiResponse({
    status: 200,
    description: 'List of all stablecoins with their supply information',
    type: StablecoinsResponseDto,
  })
  async getStablecoins(): Promise<StablecoinsResponseDto> {
    const response = await this.stablecoinsService.getStablecoins();
    return response;
  }
}
