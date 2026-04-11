/**
 * Blockchain service — anchors SHA-256 hashes of cost reports and PR diffs
 * on an Ethereum-compatible chain (Polygon Mumbai testnet by default) via ethers.js v6.
 *
 * When BLOCKCHAIN_ENABLED=false (default for local dev), all calls are no-ops that
 * return { txHash: "not-anchored", explorerUrl: "" }.  The SHA-256 tamper-detection
 * still works perfectly without the on-chain anchor.
 */
import { ethers }     from 'ethers';
import { config }     from '../../config.js';
import { COST_AUDIT_ABI } from './abi.js';

// ── Singleton provider / wallet / contract ────────────────────────────────────

let _contract: ethers.Contract | null = null;

function getContract(): ethers.Contract | null {
  if (!config.BLOCKCHAIN_ENABLED) return null;

  if (_contract) return _contract;

  if (!config.BLOCKCHAIN_RPC_URL || !config.WALLET_PRIVATE_KEY || !config.CONTRACT_ADDRESS) {
    console.warn('[blockchain] BLOCKCHAIN_ENABLED=true but RPC_URL / PRIVATE_KEY / CONTRACT_ADDRESS missing — falling back to no-op');
    return null;
  }

  const provider = new ethers.JsonRpcProvider(config.BLOCKCHAIN_RPC_URL);
  const wallet   = new ethers.Wallet(config.WALLET_PRIVATE_KEY, provider);
  _contract      = new ethers.Contract(config.CONTRACT_ADDRESS, COST_AUDIT_ABI, wallet);
  return _contract;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface StoreResult {
  txHash:      string;
  explorerUrl: string;
  anchored:    boolean;
}

export interface OnChainRecord {
  hash:        string;   // bytes32 hex
  timestamp:   number;   // UNIX seconds
  recordType:  string;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Store a SHA-256 hash on-chain.
 * @param id         Unique identifier (e.g. report UUID or "pr-42")
 * @param hashHex    64-char hex string (0x-prefixed or bare)
 * @param recordType "report" | "pr-diff"
 */
export async function storeHash(
  id: string,
  hashHex: string,
  recordType: 'report' | 'pr-diff',
): Promise<StoreResult> {
  const contract = getContract();

  if (!contract) {
    return { txHash: 'not-anchored', explorerUrl: '', anchored: false };
  }

  // ethers.js expects bytes32 as a 0x-prefixed 32-byte hex string
  const bytes32 = '0x' + hashHex.replace(/^0x/, '').padStart(64, '0');

  try {
    const tx  = await (contract.storeHash as any)(id, bytes32, recordType);
    const rec = await tx.wait(1); // wait for 1 confirmation
    const txHash      = rec.hash ?? tx.hash;
    const explorerUrl = `${config.EXPLORER_BASE_URL}/${txHash}`;
    return { txHash, explorerUrl, anchored: true };
  } catch (err: any) {
    console.error('[blockchain] storeHash failed:', err.message);
    // Soft failure — don't crash the API; return unanchored
    return { txHash: 'anchor-failed', explorerUrl: '', anchored: false };
  }
}

/**
 * Retrieve an on-chain record by ID.
 * Returns null when blockchain is disabled or the record doesn't exist.
 */
export async function getOnChainRecord(id: string): Promise<OnChainRecord | null> {
  const contract = getContract();
  if (!contract) return null;

  try {
    const [hash, ts, recordType] = await (contract.getHash as any)(id) as [string, bigint, string];
    // A hash of all zeros means the record was never stored
    if (hash === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      return null;
    }
    return {
      hash:       hash.replace(/^0x/, ''),
      timestamp:  Number(ts),
      recordType,
    };
  } catch (err: any) {
    console.error('[blockchain] getHash failed:', err.message);
    return null;
  }
}
