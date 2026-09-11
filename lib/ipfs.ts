export const IPFS_GATEWAY = "https://amgbearth.myfilebase.com/ipfs/";

export const METADATA_BASE_CID = "QmdkLm4gFZaRhjGMjZM8ouuQ8fC7AMTLWNDkDmytbYZY5k";

export function ipfsToGateway(uri: string): string {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) return IPFS_GATEWAY + uri.slice(7);
  if (uri.startsWith("ipfs/"))   return IPFS_GATEWAY + uri.slice(5);
  if (uri.startsWith("/ipfs/"))  return IPFS_GATEWAY + uri.slice(6);
  return uri;
}

export function tokenMetadataUrl(tokenId: number): string {
  return `${IPFS_GATEWAY}${METADATA_BASE_CID}/${tokenId}`;
}

export function tokenImageUrl(tokenId: number): string {
  return tokenMetadataUrl(tokenId);
}

export interface NFTAttribute {
  trait_type: string;
  value: string | number;
}

export interface NFTMetadata {
  name: string;
  description?: string;
  image: string;
  animation_url?: string;
  attributes: NFTAttribute[];
}

export async function fetchTokenMetadata(tokenId: number): Promise<NFTMetadata | null> {
  try {
    const res = await fetch(tokenMetadataUrl(tokenId), {
      cache: "force-cache",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    return (await res.json()) as NFTMetadata;
  } catch {
    return null;
  }
}

export async function fetchMetadata(uri: string): Promise<NFTMetadata | null> {
  try {
    const url = ipfsToGateway(uri);
    const res = await fetch(url, {
      cache: "force-cache",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    return (await res.json()) as NFTMetadata;
  } catch {
    return null;
  }
}

export function ipfsToHttp(uri: string): string {
  return ipfsToGateway(uri);
}
