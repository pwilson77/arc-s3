import { ethers } from 'ethers';

const privKeys = [
  '0xee5a27f95e56061133185d989461a59d5cf159ba51d9cfb93d24a08c40528f85',
  '0x1f9d12aeac1d9d91db54e3580fd83abfa871e9ff8df2a43eb2d38f2faad96496',
  '0x5884398725eba54950506eba51b4a201500686a1c351793f9a2785aa53d327e5'
];

const labels = ['ALPHA', 'BETA', 'GAMMA'];
const rpcUrl = 'https://rpc.testnet.arc.network';
const provider = new ethers.JsonRpcProvider(rpcUrl);
const usdcAddress = '0x3600000000000000000000000000000000000000';

const usdcAbi = ['function balanceOf(address) public view returns (uint256)'];

async function checkBalances() {
  for (let i = 0; i < privKeys.length; i++) {
    const wallet = new ethers.Wallet(privKeys[i]);
    const address = wallet.address;
    
    try {
      const contract = new ethers.Contract(usdcAddress, usdcAbi, provider);
      const balance = await contract.balanceOf(address);
      const balanceInUsdc = ethers.formatUnits(balance, 6);
      console.log(`${labels[i]}: ${address} → ${balanceInUsdc} USDC`);
    } catch (err) {
      console.error(`${labels[i]}: Error - ${err.message}`);
    }
  }
}

checkBalances();
