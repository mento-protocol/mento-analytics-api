import { Injectable, Logger } from '@nestjs/common';
import { AddressCategory, Chain } from '@types';
import { BalanceFetcherConfig, BaseBalanceFetcher } from '.';
import { ConfigService } from '@nestjs/config';
import { withRetry } from '@/utils';
import * as Sentry from '@sentry/nestjs';
interface BlockchainInfoResponse {
  [address: string]: {
    final_balance: number;
    n_tx: number;
    total_received: number;
  };
}

interface BlockstreamResponse {
  chain_stats: {
    funded_txo_sum: number;
    spent_txo_sum: number;
  };
}

// We use two different APIs to fetch the balance because they both vary in reliability.
// This way we can fallback to the other API if one is down.
@Injectable()
export class BitcoinBalanceFetcher extends BaseBalanceFetcher {
  private readonly logger = new Logger(BitcoinBalanceFetcher.name);
  private readonly blockstreamBaseUrl: string;
  private readonly blockchainInfoBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    const config: BalanceFetcherConfig = {
      chain: Chain.BITCOIN,
      supportedCategories: [AddressCategory.MENTO_RESERVE],
    };
    super(config);

    this.blockstreamBaseUrl = this.configService.get<string>('BLOCKSTREAM_API_URL');
    if (!this.blockstreamBaseUrl) {
      throw new Error('BLOCKSTREAM_API_URL is not defined in environment variables');
    }

    this.blockchainInfoBaseUrl = this.configService.get<string>('BLOCKCHAIN_INFO_API_URL');
    if (!this.blockchainInfoBaseUrl) {
      throw new Error('BLOCKCHAIN_INFO_API_URL is not defined in environment variables');
    }
  }

  async fetchBalance(_tokenAddress: string | null, accountAddress: string, category: AddressCategory): Promise<string> {
    try {
      switch (category) {
        case AddressCategory.MENTO_RESERVE:
          return await this.fetchMentoReserveBalance(accountAddress);
        default:
          throw new Error(`Unsupported address category: ${category}`);
      }
    } catch (error) {
      this.logger.error(error, `Failed to fetch Bitcoin balance for ${accountAddress}`);
      Sentry.captureException(error, {
        level: 'error',
        extra: {
          address: accountAddress,
          chain: Chain.BITCOIN,
          category: AddressCategory.MENTO_RESERVE,
          description: `Failed to fetch Bitcoin balance for ${accountAddress}`,
        },
      });
      return '0';
    }
  }

  private async fetchMentoReserveBalance(accountAddress: string): Promise<string> {
    const [blockchainInfo, blockstream] = await Promise.allSettled([
      this.fetchFromBlockchainInfo(accountAddress),
      this.fetchFromBlockstream(accountAddress),
    ]);

    if (blockchainInfo.status === 'rejected' && blockstream.status === 'rejected') {
      throw new Error('All Bitcoin balance providers failed');
    }

    if (blockchainInfo.status === 'fulfilled') {
      return blockchainInfo.value;
    }

    if (blockstream.status === 'fulfilled') {
      return blockstream.value;
    }

    throw new Error('No valid Bitcoin balance found');
  }

  private async fetchFromBlockchainInfo(address: string): Promise<string> {
    return withRetry(
      async () => {
        const requestUrl = new URL(this.blockchainInfoBaseUrl);
        requestUrl.pathname = '/balance';
        requestUrl.searchParams.set('active', address);

        const response = await fetch(requestUrl.toString());
        if (!response.ok) {
          throw new Error(`Blockchain.info API error: ${response.statusText}`);
        }

        const data = (await response.json()) as BlockchainInfoResponse;
        if (!data[address]?.final_balance) {
          throw new Error('Invalid response from blockchain.info');
        }

        const balance = data[address].final_balance / 100000000;
        return balance.toFixed(8);
      },
      `Failed to fetch balance from blockchain.info for address ${address}`,
      {
        logger: new Logger(BitcoinBalanceFetcher.name),
      },
    );
  }

  private async fetchFromBlockstream(address: string): Promise<string> {
    return withRetry(
      async () => {
        const requestUrl = new URL(this.blockstreamBaseUrl);
        requestUrl.pathname = `/api/address/${address}`;

        const response = await fetch(requestUrl.toString());
        if (!response.ok) {
          throw new Error(`Blockstream API error: ${response.statusText}`);
        }

        const data = (await response.json()) as BlockstreamResponse;
        const balance = (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) / 100000000;
        return balance.toFixed(8);
      },
      `Failed to fetch balance from blockstream for address ${address}`,
      {
        logger: new Logger(BitcoinBalanceFetcher.name),
      },
    );
  }
}
