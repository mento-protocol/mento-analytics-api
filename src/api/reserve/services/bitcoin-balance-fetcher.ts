import { Injectable, Logger } from '@nestjs/common';

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
export class BitcoinBalanceFetcher {
  private readonly logger = new Logger(BitcoinBalanceFetcher.name);

  /**
   * Fetches Bitcoin balance from multiple providers and returns the most reliable result
   */
  async fetchBalance(address: string): Promise<string> {
    try {
      const [blockchainInfo, blockstream] = await Promise.allSettled([
        this.fetchFromBlockchainInfo(address),
        this.fetchFromBlockstream(address),
      ]);

      // If both failed, throw error
      if (blockchainInfo.status === 'rejected' && blockstream.status === 'rejected') {
        throw new Error('All Bitcoin balance providers failed');
      }

      // Return the first successful result
      if (blockchainInfo.status === 'fulfilled') {
        return blockchainInfo.value;
      }

      if (blockstream.status === 'fulfilled') {
        return blockstream.value;
      }

      throw new Error('No valid Bitcoin balance found');
    } catch (error) {
      this.logger.error(`Failed to fetch Bitcoin balance for ${address}:`, error);
      return '0';
    }
  }

  private async fetchFromBlockchainInfo(address: string): Promise<string> {
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
    const response = await fetch(`https://blockstream.info/api/address/${address}`);
    if (!response.ok) {
      throw new Error(`Blockstream API error: ${response.statusText}`);
    }

    const data = (await response.json()) as BlockstreamResponse;
    const balance = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
    return balance.toString();
  }
}
