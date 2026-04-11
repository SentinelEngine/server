# CloudCost Lens — Blockchain Module

Hardhat project for the `CostAudit` smart contract. Anchors SHA-256 hashes of cost reports and PR diffs on-chain for tamper-proof audit trails.

## Quick Start (Local Demo — no MATIC needed)

```bash
cd blockchain
npm install

# Terminal 1: Start local Hardhat node
npm run node

# Terminal 2: Deploy to local node
npm run deploy:local
# → prints: CostAudit deployed to: 0x5FbDB...
```

Copy the printed address to `d:\server\.env`:
```
CONTRACT_ADDRESS=0x5FbDB...
BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
WALLET_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
BLOCKCHAIN_ENABLED=true
```

## Deploy to Polygon Mumbai Testnet

1. Get test MATIC: https://faucet.polygon.technology/
2. Set env vars in `d:\server\.env`:
   ```
   BLOCKCHAIN_RPC_URL=https://rpc-mumbai.maticvigil.com
   WALLET_PRIVATE_KEY=0x<your-key>
   BLOCKCHAIN_ENABLED=true
   ```
3. Run: `npm run deploy:mumbai`
4. Copy the `CONTRACT_ADDRESS` from output to `.env`

## Contract: CostAudit.sol

- `storeHash(id, bytes32Hash, recordType)` — write-once, owner-only
- `getHash(id)` → `(bytes32, uint256, string)` — public read
- Emits `HashStored(id, hash, timestamp)` event

## Verify on Polygonscan

```
https://mumbai.polygonscan.com/tx/<txHash>
```

The backend automatically builds the explorer URL and returns it in the API response.
