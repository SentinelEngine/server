/**
 * CostAudit deployment script.
 *
 * Usage:
 *   Local node:  npm run deploy:local   (start node first: npm run node)
 *   Mumbai:      npm run deploy:mumbai
 *
 * After deployment, copy the contract address to your .env:
 *   CONTRACT_ADDRESS=0x...
 */
const hre = require('hardhat');
const fs  = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log(`\n🚀 Deploying CostAudit with account: ${deployer.address}`);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`   Account balance: ${hre.ethers.formatEther(balance)} ETH/MATIC`);

  const CostAudit = await hre.ethers.getContractFactory('CostAudit');
  const contract  = await CostAudit.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`\n✅ CostAudit deployed to: ${address}`);
  console.log(`   Network: ${hre.network.name}`);

  // Optionally write it to a local file for easy reference
  const outPath = path.join(__dirname, '..', 'blockchain-deployment.json');
  const data    = {
    network:         hre.network.name,
    contractAddress: address,
    deployer:        deployer.address,
    timestamp:       new Date().toISOString(),
  };
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`\n📄 Deployment info saved to: ${outPath}`);
  console.log(`\nAdd to your .env:\n   CONTRACT_ADDRESS=${address}\n`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
