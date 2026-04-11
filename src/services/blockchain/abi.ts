/**
 * CostAudit contract ABI — extracted from compiled CostAudit.sol (Solidity ^0.8.19).
 * Used by the ethers.js blockchain service to call storeHash / getHash.
 */
export const COST_AUDIT_ABI = [
  {
    inputs: [],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true,  internalType: 'string',  name: 'id',   type: 'string'  },
      { indexed: false, internalType: 'bytes32', name: 'hash', type: 'bytes32' },
      { indexed: false, internalType: 'uint256', name: 'ts',   type: 'uint256' },
    ],
    name: 'HashStored',
    type: 'event',
  },
  {
    inputs: [
      { internalType: 'string',  name: 'id',         type: 'string'  },
      { internalType: 'bytes32', name: 'hash',        type: 'bytes32' },
      { internalType: 'string',  name: 'recordType',  type: 'string'  },
    ],
    name: 'storeHash',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'string', name: 'id', type: 'string' },
    ],
    name: 'getHash',
    outputs: [
      { internalType: 'bytes32', name: '', type: 'bytes32' },
      { internalType: 'uint256', name: '', type: 'uint256' },
      { internalType: 'string',  name: '', type: 'string'  },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'owner',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
