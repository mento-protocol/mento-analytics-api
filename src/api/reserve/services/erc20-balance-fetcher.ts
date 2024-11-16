import { Contract, Provider } from 'ethers';
import { ERC20_ABI } from '@mento/sdk';

export class ERC20BalanceFetcher {
  constructor(private provider: Provider) {}

  /**
   * Fetch the balance of a token for a given holder address
   * @param tokenAddress - The address of the token
   * @param holderAddress - The address of the holder
   * @returns The balance of the token
   */
  async fetchBalance(tokenAddress: string, holderAddress: string): Promise<string> {
    const contract = new Contract(tokenAddress, ERC20_ABI, this.provider);

    const balance = await contract.balanceOf(holderAddress);
    return balance.toString();
  }
}
