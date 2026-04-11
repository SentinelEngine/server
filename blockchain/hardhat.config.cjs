require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config({ path: '../.env' });

const RPC_URL     = process.env.BLOCKCHAIN_RPC_URL  || 'http://127.0.0.1:8545';
const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY  || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Hardhat default

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.19',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // Local Hardhat node (npm run node)
    localhost: {
      url: 'http://127.0.0.1:8545',
    },
    // Polygon Mumbai testnet
    mumbai: {
      url: RPC_URL,
      accounts: [PRIVATE_KEY],
      chainId: 80001,
    },
    // Polygon mainnet (production)
    polygon: {
      url: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      accounts: [PRIVATE_KEY],
      chainId: 137,
    },
  },
  etherscan: {
    apiKey: {
      polygonMumbai: process.env.POLYGONSCAN_API_KEY || '',
      polygon:       process.env.POLYGONSCAN_API_KEY || '',
    },
  },
};
