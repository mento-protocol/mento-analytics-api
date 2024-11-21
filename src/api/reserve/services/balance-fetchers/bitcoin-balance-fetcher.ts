import { Injectable, Logger } from '@nestjs/common';
import { AddressCategory, Chain } from 'src/types';
import { BalanceFetcherConfig, BaseBalanceFetcher } from '.';

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

@Injectable()
export class BitcoinBalanceFetcher extends BaseBalanceFetcher {
  private readonly logger = new Logger(BitcoinBalanceFetcher.name);

  constructor() {
    const config: BalanceFetcherConfig = {
      chain: Chain.BITCOIN,
      supportedCategories: [AddressCategory.MENTO_RESERVE],
    };
    super(config);
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
      this.logger.error(`Failed to fetch Bitcoin balance for ${accountAddress}:`, error);
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
    // TODO: Remove hardcoded URL
    const response = await fetch(`https://blockchain.info/balance?active=${address}`);
    if (!response.ok) {
      throw new Error(`Blockchain.info API error: ${response.statusText}`);
    }

    const data = (await response.json()) as BlockchainInfoResponse;
    if (!data[address]?.final_balance) {
      throw new Error('Invalid response from blockchain.info');
    }

    const balance = data[address].final_balance / 100000000;
    return balance.toFixed(8);
  }

  private async fetchFromBlockstream(address: string): Promise<string> {
    // TODO: Remove hardcoded URL
    const response = await fetch(`https://blockstream.info/api/address/${address}`);
    if (!response.ok) {
      throw new Error(`Blockstream API error: ${response.statusText}`);
    }

    const data = (await response.json()) as BlockstreamResponse;
    const balance = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
    return balance.toString();
  }
}