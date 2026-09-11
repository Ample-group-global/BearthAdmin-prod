import { sepolia } from "viem/chains";
import type { Chain } from "viem";

export interface ChainConfig {
  chain: Chain;
  chainId: number;
  name: string;
  shortName: string;
  contractAddress: string;
  rpcUrl: string;
  blockExplorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  color: string;
  deploymentBlock?: number;
}

export const SUPPORTED_CHAINS: ChainConfig[] = [
  {
    chain: sepolia,
    chainId: 11155111,
    name: "Sepolia",
    shortName: "Sepolia",
    contractAddress: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA || "0x97445D1A39cE00b631A565a1923BE62BEa6Fc8cA",
    rpcUrl: process.env.NEXT_PUBLIC_RPC_SEPOLIA || "https://ethereum-sepolia-rpc.publicnode.com",
    blockExplorer: "https://sepolia.etherscan.io",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    color: "purple",
    deploymentBlock: 11300000,
  },
];

export const DEFAULT_CHAIN = SUPPORTED_CHAINS[0];

export function getChainConfig(chainId: number): ChainConfig | undefined {
  return SUPPORTED_CHAINS.find((c) => c.chainId === chainId);
}

export function getChainConfigOrDefault(chainId: number): ChainConfig {
  return getChainConfig(chainId) || DEFAULT_CHAIN;
}
