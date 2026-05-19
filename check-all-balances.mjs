import { ethers } from 'ethers';

const privKeys = [
  '0xee5a27f95e56061133185d989461a59d5cf159ba51d9cfb93d24a08c40528f85',
  '0x1f9d12aeac1d9d91db54e3580fd83abfa871e9ff8df2a43eb2d38f2faad96496',
  '0x5884398725eba54950506eba51b4a201500686a1c351793f9a2785aa53d327e5'
];

const labels = ['ALPHA', 'BETA', 'GAMMA'];
const bscRpc = 'https://data-seed-prebsc-1-s1.bnbchain.org:8545';
const arcRpc = 'https://rpc.testnet.arc.network';

async function checkBalances() {
  console.log('=== BSC Testnet (BNB) ===');
  const bscProvider = new ethers.JsonRpcProvider(bscRpc);
  
  for (let i = 0; i < privKeys.length; i++) {
    const wallet = new ethers.Wallet(privKeys[i]);
    const address = wallet.address;
    
    try {
      const balance = await bscProvider.getBalance(address);
      const balanceInBnb = ethers.formatEther(balance);
      console.log(`${labels[i]}: ${address} → ${balanceInBnb} BNB`);
    } catch (err) {
      console.error(`${labels[i]}: Error - ${err.message}`);
    }
  }
  
  console.log('\n=== Arc Testnet (USDC) ===');
  const arcProvider = new ethers.JsonRpcProvider(arcRpc);
  const usdcAddress = '0x3600000000000000000000000000000000000000';
  const usdcAbi = ['function balanceOf(address) public view returns (uint256)'];
  
  for (let i = 0; i < privKeys.length; i++) {
    const wallet = new ethers.Wallet(privKeys[i]);
    const address = wallet.address;
    
    try {
      const contract = new ethers.Contract(usdcAddress, usdcAbi, arcProvider);
      const balance = await contract.balanceOf(address);
      const balanceInUsdc = ethers.formatUnits(balance, 6);
      console.log(`${labels[i]}: ${address} → ${balanceInUsdc} USDC`);
    } catch (err) {
      console.error(`${labels[i]}: Error - ${err.message}`);
    }
  }
}

checkBalances();
