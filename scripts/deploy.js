const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    
    console.log("Deploying contracts with account:", deployer.address);
    
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const tokenA = await MockERC20.deploy("Token A", "TKA");
    const tokenB = await MockERC20.deploy("Token B", "TKB");
    
    await tokenA.waitForDeployment();
    await tokenB.waitForDeployment();
    
    const DEX = await hre.ethers.getContractFactory("DEX");
    const dex = await DEX.deploy(await tokenA.getAddress(), await tokenB.getAddress());
    
    await dex.waitForDeployment();
    
    console.log("TokenA deployed to:", await tokenA.getAddress());
    console.log("TokenB deployed to:", await tokenB.getAddress());
    console.log("DEX deployed to:", await dex.getAddress());
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
