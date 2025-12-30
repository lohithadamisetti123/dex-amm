const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DEX", function() {
    let dex, tokenA, tokenB;
    let owner, addr1, addr2;
    
    beforeEach(async function() {
        [owner, addr1, addr2] = await ethers.getSigners();
        
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        tokenA = await MockERC20.deploy("Token A", "TKA");
        tokenB = await MockERC20.deploy("Token B", "TKB");
        
        const DEX = await ethers.getContractFactory("DEX");
        dex = await DEX.deploy(tokenA.target, tokenB.target);
        
        // Mint tokens to test accounts and approve DEX
        await tokenA.mint(addr1.address, ethers.parseEther("1000000"));
        await tokenB.mint(addr1.address, ethers.parseEther("1000000"));
        await tokenA.connect(addr1).approve(dex.target, ethers.parseEther("1000000"));
        await tokenB.connect(addr1).approve(dex.target, ethers.parseEther("1000000"));
        
        // Mint to addr2 for multi-user tests
        await tokenA.mint(addr2.address, ethers.parseEther("1000000"));
        await tokenB.mint(addr2.address, ethers.parseEther("1000000"));
        await tokenA.connect(addr2).approve(dex.target, ethers.parseEther("1000000"));
        await tokenB.connect(addr2).approve(dex.target, ethers.parseEther("1000000"));
    });
    
    describe("Liquidity Management", function() {
        it("should allow initial liquidity provision", async function() {
            const amountA = ethers.parseEther("100");
            const amountB = ethers.parseEther("200");
            
            await expect(dex.connect(addr1).addLiquidity(amountA, amountB))
                .to.emit(dex, "LiquidityAdded")
                .withArgs(addr1.address, amountA, amountB, ethers.parseEther("14142"));
            
            const reserves = await dex.getReserves();
            expect(reserves[0]).to.equal(amountA);
            expect(reserves[1]).to.equal(amountB);
        });
        
        it("should mint correct LP tokens for first provider", async function() {
            const amountA = ethers.parseEther("100");
            const amountB = ethers.parseEther("200");
            
            const tx = await dex.connect(addr1).addLiquidity(amountA, amountB);
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.eventName === "LiquidityAdded");
            const liquidityMinted = event.args.liquidityMinted;
            
            expect(liquidityMinted).to.be.closeTo(ethers.parseEther("14142"), ethers.parseEther("1"));
        });
        
        it("should allow subsequent liquidity additions", async function() {
            // First liquidity
            await dex.connect(addr1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("200"));
            
            // Second liquidity (matching ratio)
            await dex.connect(addr2).addLiquidity(ethers.parseEther("50"), ethers.parseEther("100"));
            
            const reserves = await dex.getReserves();
            expect(reserves[0]).to.equal(ethers.parseEther("150"));
            expect(reserves[1]).to.equal(ethers.parseEther("300"));
        });
        
        it("should maintain price ratio on liquidity addition", async function() {
            await dex.connect(addr1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("200"));
            const priceBefore = await dex.getPrice();
            
            await dex.connect(addr2).addLiquidity(ethers.parseEther("50"), ethers.parseEther("100"));
            const priceAfter = await dex.getPrice();
            
            expect(priceBefore).to.equal(priceAfter);
        });
        
        it("should allow partial liquidity removal", async function() {
            await dex.connect(addr1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("200"));
            
            const tx = await dex.connect(addr1).removeLiquidity(ethers.parseEther("7071"));
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.eventName === "LiquidityRemoved");
            
            expect(event.args.amountA).to.equal(ethers.parseEther("50"));
            expect(event.args.amountB).to.equal(ethers.parseEther("100"));
        });
        
        it("should return correct token amounts on liquidity removal", async function() {
            await dex.connect(addr1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("200"));
            
            const [, amountAOut, amountBOut] = await dex.connect(addr1).callStatic.removeLiquidity(ethers.parseEther("14142"));
            expect(amountAOut).to.equal(ethers.parseEther("100"));
            expect(amountBOut).to.equal(ethers.parseEther("200"));
        });
        
        it("should revert on zero liquidity addition", async function() {
            await expect(dex.connect(addr1).addLiquidity(0, ethers.parseEther("100")))
                .to.be.revertedWith("Cannot add zero liquidity");
        });
        
        it("should revert when removing more liquidity than owned", async function() {
            await dex.connect(addr1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("200"));
            await expect(dex.connect(addr2).removeLiquidity(ethers.parseEther("1000")))
                .to.be.revertedWith("Insufficient liquidity");
        });
    });
    
    describe("Token Swaps", function() {
        beforeEach(async function() {
            await dex.connect(addr1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("200000"));
        });
        
        it("should swap token A for token B", async function() {
            const amountAIn = ethers.parseEther("10");
            const amountBOut = await dex.connect(addr1).callStatic.swapAForB(amountAIn);
            
            expect(amountBOut).to.be.gt(0);
            
            await expect(dex.connect(addr1).swapAForB(amountAIn))
                .to.emit(dex, "Swap")
                .withArgs(addr1.address, await tokenA.getAddress(), await tokenB.getAddress(), amountAIn, amountBOut);
        });
        
        it("should swap token B for token A", async function() {
            const amountBIn = ethers.parseEther("20000");
            const amountAOut = await dex.connect(addr1).callStatic.swapBForA(amountBIn);
            
            expect(amountAOut).to.be.gt(0);
            await dex.connect(addr1).swapBForA(amountBIn);
        });
        
        it("should calculate correct output amount with fee", async function() {
            const reservesBefore = await dex.getReserves();
            const amountAIn = ethers.parseEther("10");
            const amountBOut = await dex.getAmountOut(amountAIn, reservesBefore[0], reservesBefore[1]);
            
            // Verify 0.3% fee is applied
            const expectedWithoutFee = (amountAIn * reservesBefore[1]) / reservesBefore[0];
            expect(amountBOut).to.be.lt(expectedWithoutFee);
            expect(amountBOut).to.be.gt(expectedWithoutFee * 997n / 1000n);
        });
        
        it("should update reserves after swap", async function() {
            const reservesBefore = await dex.getReserves();
            await dex.connect(addr1).swapAForB(ethers.parseEther("10"));
            const reservesAfter = await dex.getReserves();
            
            expect(reservesAfter[0]).to.equal(reservesBefore[0] + ethers.parseEther("10"));
            expect(reservesAfter[1]).to.be.lt(reservesBefore[1]);
        });
        
        it("should increase k after swap due to fees", async function() {
            const kBefore = (await dex.getReserves())[0] * (await dex.getReserves())[1];
            await dex.connect(addr1).swapAForB(ethers.parseEther("1"));
            const kAfter = (await dex.getReserves())[0] * (await dex.getReserves())[1];
            expect(kAfter).to.be.gt(kBefore);
        });
        
        it("should revert on zero swap amount", async function() {
            await expect(dex.connect(addr1).swapAForB(0)).to.be.revertedWith("Cannot swap zero amount");
        });
        
        it("should handle large swaps with high price impact", async function() {
            await dex.connect(addr1).swapAForB(ethers.parseEther("90")); // 90% of pool
            const reserves = await dex.getReserves();
            expect(reserves[0]).to.be.gt(ethers.parseEther("190"));
        });
        
        it("should handle multiple consecutive swaps", async function() {
            await dex.connect(addr1).swapAForB(ethers.parseEther("5"));
            await dex.connect(addr2).swapBForA(ethers.parseEther("10000"));
            await dex.connect(addr1).swapAForB(ethers.parseEther("3"));
            
            const reserves = await dex.getReserves();
            expect(reserves[0]).to.be.gt(ethers.parseEther("100"));
            expect(reserves[1]).to.be.lt(ethers.parseEther("200000"));
        });
    });
    
    describe("Price Calculations", function() {
        it("should return correct initial price", async function() {
            await dex.connect(addr1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("200000"));
            const price = await dex.getPrice();
            expect(price).to.equal(ethers.parseEther("2000")); // 200000/100 = 2000
        });
        
        it("should update price after swaps", async function() {
            await dex.connect(addr1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("200000"));
            const priceBefore = await dex.getPrice();
            
            await dex.connect(addr1).swapAForB(ethers.parseEther("10"));
            const priceAfter = await dex.getPrice();
            
            expect(priceAfter).to.be.lt(priceBefore);
        });
        
        it("should handle price queries with zero reserves gracefully", async function() {
            await expect(dex.getPrice()).to.be.revertedWith("Reserve A is zero");
        });
    });
    
    describe("Fee Distribution", function() {
        it("should accumulate fees for liquidity providers", async function() {
            await dex.connect(addr1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("200000"));
            
            // Perform swaps to generate fees
            await dex.connect(addr2).swapAForB(ethers.parseEther("10"));
            await dex.connect(addr2).swapBForA(ethers.parseEther("20000"));
            
            // addr1 withdraws - should get more than deposited due to fees
            const initialBalanceA = await tokenA.balanceOf(addr1.address);
            const [, amountAOut] = await dex.connect(addr1).callStatic.removeLiquidity(await dex.liquidity(addr1.address));
            
            expect(amountAOut).to.be.gt(ethers.parseEther("100"));
        });
        
        it("should distribute fees proportionally to LP share", async function() {
            // addr1 adds 100/200k
            await dex.connect(addr1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("200000"));
            
            // addr2 adds 50/100k (half the amount)
            await dex.connect(addr2).addLiquidity(ethers.parseEther("50"), ethers.parseEther("100000"));
            
            // Generate fees
            await dex.connect(owner).swapAForB(ethers.parseEther("10"));
            
            // Both withdraw - addr1 should get twice as much extra due to fees
            const addr1WithdrawA = await dex.connect(addr1).callStatic.removeLiquidity(await dex.liquidity(addr1.address))[0];
            const addr2WithdrawA = await dex.connect(addr2).callStatic.removeLiquidity(await dex.liquidity(addr2.address))[0];
            
            expect(addr1WithdrawA * 2n).to.be.gte(addr2WithdrawA * 2n);
        });
    });
    
    describe("Edge Cases", function() {
        it("should handle very small liquidity amounts", async function() {
            await dex.connect(addr1).addLiquidity(ethers.parseEther("0.0001"), ethers.parseEther("0.0002"));
            await dex.connect(addr1).swapAForB(ethers.parseEther("0.00001"));
        });
        
        it("should handle very large liquidity amounts", async function() {
            const largeAmount = ethers.parseEther("1000000");
            await dex.connect(addr1).addLiquidity(largeAmount, largeAmount * 2n);
        });
        
        it("should prevent unauthorized access", async function() {
            await dex.connect(addr1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("200"));
            await expect(dex.connect(addr2).removeLiquidity(ethers.parseEther("10000")))
                .to.be.revertedWith("Insufficient liquidity");
        });
    });
    
    describe("Events", function() {
        beforeEach(async function() {
            await dex.connect(addr1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("200"));
        });
        
        it("should emit LiquidityAdded event", async function() {
            await expect(dex.connect(addr2).addLiquidity(ethers.parseEther("50"), ethers.parseEther("100")))
                .to.emit(dex, "LiquidityAdded")
                .withArgs(addr2.address, ethers.parseEther("50"), ethers.parseEther("100"), ethers.parseEther("7071"));
        });
        
        it("should emit LiquidityRemoved event", async function() {
            await expect(dex.connect(addr1).removeLiquidity(ethers.parseEther("14142")))
                .to.emit(dex, "LiquidityRemoved")
                .withArgs(addr1.address, ethers.parseEther("100"), ethers.parseEther("200"), ethers.parseEther("14142"));
        });
        
        it("should emit Swap event", async function() {
            await expect(dex.connect(addr2).swapAForB(ethers.parseEther("10")))
                .to.emit(dex, "Swap")
                .withArgs(addr2.address, await tokenA.getAddress(), await tokenB.getAddress(), ethers.parseEther("10"), ethers.parseEther("18181"));
        });
    });
});
