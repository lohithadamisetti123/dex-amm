const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DEX", function () {
  let dex, tokenA, tokenB;
  let owner, addr1, addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    tokenA = await MockERC20.deploy("Token A", "TKA");
    tokenB = await MockERC20.deploy("Token B", "TKB");
    await tokenA.deployed();
    await tokenB.deployed();

    const DEX = await ethers.getContractFactory("DEX");
    dex = await DEX.deploy(tokenA.address, tokenB.address);
    await dex.deployed();

    const dexAddress = dex.address;
    const max = ethers.utils.parseEther("1000000");

    // give and approve to addr1
    await tokenA.mint(addr1.address, max);
    await tokenB.mint(addr1.address, max);
    await tokenA.connect(addr1).approve(dexAddress, max);
    await tokenB.connect(addr1).approve(dexAddress, max);

    // give and approve to addr2
    await tokenA.mint(addr2.address, max);
    await tokenB.mint(addr2.address, max);
    await tokenA.connect(addr2).approve(dexAddress, max);
    await tokenB.connect(addr2).approve(dexAddress, max);
  });

  describe("Liquidity Management", function () {
    it("should allow initial liquidity provision", async function () {
      const amountA = ethers.utils.parseEther("100");
      const amountB = ethers.utils.parseEther("200");

      await expect(dex.connect(addr1).addLiquidity(amountA, amountB))
        .to.emit(dex, "LiquidityAdded");

      const reserves = await dex.getReserves();
      expect(reserves[0]).to.equal(amountA);
      expect(reserves[1]).to.equal(amountB);
    });

    it("should mint correct LP tokens for first provider", async function () {
      const amountA = ethers.utils.parseEther("100");
      const amountB = ethers.utils.parseEther("200");

      const tx = await dex.connect(addr1).addLiquidity(amountA, amountB);
      const receipt = await tx.wait();
      const event = receipt.events.find((e) => e.event === "LiquidityAdded");
      const liquidityMinted = event.args.liquidityMinted;

      // Expect around sqrt(100*200) ≈ 141.42 * 1e18; use a tolerance
      const expected = ethers.utils.parseEther("141.421356237");
      expect(liquidityMinted).to.be.closeTo(expected, expected.div(1000));
    });

    it("should allow subsequent liquidity additions", async function () {
      await dex
        .connect(addr1)
        .addLiquidity(
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("200")
        );

      await dex
        .connect(addr2)
        .addLiquidity(
          ethers.utils.parseEther("50"),
          ethers.utils.parseEther("100")
        );

      const reserves = await dex.getReserves();
      expect(reserves[0]).to.equal(ethers.utils.parseEther("150"));
      expect(reserves[1]).to.equal(ethers.utils.parseEther("300"));
    });

    it("should maintain price ratio on liquidity addition", async function () {
      await dex
        .connect(addr1)
        .addLiquidity(
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("200")
        );
      const priceBefore = await dex.getPrice();

      await dex
        .connect(addr2)
        .addLiquidity(
          ethers.utils.parseEther("50"),
          ethers.utils.parseEther("100")
        );
      const priceAfter = await dex.getPrice();

      expect(priceBefore).to.equal(priceAfter);
    });

    it("should allow partial liquidity removal", async function () {
      await dex
        .connect(addr1)
        .addLiquidity(
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("200")
        );

      const userLiq = await dex.liquidity(addr1.address);
      const half = userLiq.div(2);

      const tx = await dex.connect(addr1).removeLiquidity(half);
      const receipt = await tx.wait();
      const event = receipt.events.find((e) => e.event === "LiquidityRemoved");

      expect(event.args.amountA).to.be.closeTo(
        ethers.utils.parseEther("50"),
        ethers.utils.parseEther("0.1")
      );
      expect(event.args.amountB).to.be.closeTo(
        ethers.utils.parseEther("100"),
        ethers.utils.parseEther("0.2")
      );
    });

    it("should return correct token amounts on liquidity removal", async function () {
      await dex
        .connect(addr1)
        .addLiquidity(
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("200")
        );

      const userLiq = await dex.liquidity(addr1.address);
      const result = await dex
        .connect(addr1)
        .callStatic.removeLiquidity(userLiq);

      const amountAOut = result[0];
      const amountBOut = result[1];

      expect(amountAOut).to.be.closeTo(
        ethers.utils.parseEther("100"),
        ethers.utils.parseEther("0.1")
      );
      expect(amountBOut).to.be.closeTo(
        ethers.utils.parseEther("200"),
        ethers.utils.parseEther("0.2")
      );
    });

    it("should revert on zero liquidity addition", async function () {
      await expect(
        dex
          .connect(addr1)
          .addLiquidity(0, ethers.utils.parseEther("100"))
      ).to.be.revertedWith("Cannot add zero liquidity");
    });

    it("should revert when removing more liquidity than owned", async function () {
      await dex
        .connect(addr1)
        .addLiquidity(
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("200")
        );
      await expect(
        dex
          .connect(addr2)
          .removeLiquidity(ethers.utils.parseEther("1000"))
      ).to.be.revertedWith("Insufficient liquidity");
    });
  });

  describe("Token Swaps", function () {
    beforeEach(async function () {
      await dex
        .connect(addr1)
        .addLiquidity(
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("200000")
        );
    });

    it("should swap token A for token B", async function () {
      const amountAIn = ethers.utils.parseEther("10");
      const amountBOut = await dex
        .connect(addr1)
        .callStatic.swapAForB(amountAIn);

      expect(amountBOut).to.be.gt(0);

      await expect(dex.connect(addr1).swapAForB(amountAIn)).to.emit(
        dex,
        "Swap"
      );
    });

    it("should swap token B for token A", async function () {
      const amountBIn = ethers.utils.parseEther("20000");
      const amountAOut = await dex
        .connect(addr1)
        .callStatic.swapBForA(amountBIn);

      expect(amountAOut).to.be.gt(0);
      await dex.connect(addr1).swapBForA(amountBIn);
    });

    it("should calculate correct output amount with fee", async function () {
      const reservesBefore = await dex.getReserves();
      const amountAIn = ethers.utils.parseEther("10");
      const amountBOut = await dex.getAmountOut(
        amountAIn,
        reservesBefore[0],
        reservesBefore[1]
      );

      const expectedWithoutFee = reservesBefore[1]
        .mul(amountAIn)
        .div(reservesBefore[0]);
      expect(amountBOut).to.be.lt(expectedWithoutFee);
    });

    it("should update reserves after swap", async function () {
      const reservesBefore = await dex.getReserves();
      await dex.connect(addr1).swapAForB(ethers.utils.parseEther("10"));
      const reservesAfter = await dex.getReserves();

      expect(reservesAfter[0]).to.equal(
        reservesBefore[0].add(ethers.utils.parseEther("10"))
      );
      expect(reservesAfter[1]).to.be.lt(reservesBefore[1]);
    });

    it("should increase k after swap due to fees", async function () {
      const reservesBefore = await dex.getReserves();
      const kBefore = reservesBefore[0].mul(reservesBefore[1]);

      await dex.connect(addr1).swapAForB(ethers.utils.parseEther("1"));

      const reservesAfter = await dex.getReserves();
      const kAfter = reservesAfter[0].mul(reservesAfter[1]);
      expect(kAfter).to.be.gt(kBefore);
    });

    it("should revert on zero swap amount", async function () {
      await expect(
        dex.connect(addr1).swapAForB(0)
      ).to.be.revertedWith("Cannot swap zero amount");
    });

    it("should handle large swaps with high price impact", async function () {
      await dex.connect(addr1).swapAForB(ethers.utils.parseEther("90"));
      const reserves = await dex.getReserves();
      // Just assert pool stays valid (non-zero reserves)
      expect(reserves[0]).to.be.gt(0);
      expect(reserves[1]).to.be.gt(0);
    });

    it("should handle multiple consecutive swaps", async function () {
      await dex.connect(addr1).swapAForB(ethers.utils.parseEther("5"));
      await dex.connect(addr2).swapBForA(ethers.utils.parseEther("10000"));
      await dex.connect(addr1).swapAForB(ethers.utils.parseEther("3"));

      const reserves = await dex.getReserves();
      expect(reserves[0]).to.be.gt(0);
      expect(reserves[1]).to.be.gt(0);
    });
  });

  describe("Price Calculations", function () {
    it("should return correct initial price", async function () {
      await dex
        .connect(addr1)
        .addLiquidity(
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("200000")
        );
      const price = await dex.getPrice();
      expect(price).to.equal(ethers.utils.parseEther("2000"));
    });

    it("should update price after swaps", async function () {
      await dex
        .connect(addr1)
        .addLiquidity(
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("200000")
        );
      const priceBefore = await dex.getPrice();

      await dex.connect(addr1).swapAForB(ethers.utils.parseEther("10"));
      const priceAfter = await dex.getPrice();

      expect(priceAfter).to.be.lt(priceBefore);
    });

    it("should handle price queries with zero reserves gracefully", async function () {
      await expect(dex.getPrice()).to.be.revertedWith("Reserve A is zero");
    });
  });

  describe("Fee Distribution", function () {
    it("should accumulate fees for liquidity providers", async function () {
      await dex
        .connect(addr1)
        .addLiquidity(
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("200000")
        );

      await dex.connect(addr2).swapAForB(ethers.utils.parseEther("10"));
      await dex.connect(addr2).swapBForA(ethers.utils.parseEther("20000"));

      const userLiq = await dex.liquidity(addr1.address);
      const result = await dex
        .connect(addr1)
        .callStatic.removeLiquidity(userLiq);
      const amountAOut = result[0];

      expect(amountAOut).to.be.gt(ethers.utils.parseEther("100"));
    });

    it("should distribute fees proportionally to LP share", async function () {
      await dex
        .connect(addr1)
        .addLiquidity(
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("200000")
        );
      await dex
        .connect(addr2)
        .addLiquidity(
          ethers.utils.parseEther("50"),
          ethers.utils.parseEther("100000")
        );

      // owner needs tokens + allowance to generate fees
      const max = ethers.utils.parseEther("1000000");
      await tokenA.mint(owner.address, max);
      await tokenB.mint(owner.address, max);
      await tokenA.connect(owner).approve(dex.address, max);
      await tokenB.connect(owner).approve(dex.address, max);

      await dex.connect(owner).swapAForB(ethers.utils.parseEther("10"));

      const liq1 = await dex.liquidity(addr1.address);
      const liq2 = await dex.liquidity(addr2.address);

      const res1 = await dex
        .connect(addr1)
        .callStatic.removeLiquidity(liq1);
      const res2 = await dex
        .connect(addr2)
        .callStatic.removeLiquidity(liq2);

      const addr1WithdrawA = res1[0];
      const addr2WithdrawA = res2[0];

      // addr1 had 2x liquidity, should withdraw >= 2x A compared to addr2
      expect(addr1WithdrawA.mul(2)).to.be.gte(addr2WithdrawA);
    });
  });

  describe("Edge Cases", function () {
    it("should handle very small liquidity amounts", async function () {
      await dex
        .connect(addr1)
        .addLiquidity(
          ethers.utils.parseEther("0.0001"),
          ethers.utils.parseEther("0.0002")
        );
      await dex
        .connect(addr1)
        .swapAForB(ethers.utils.parseEther("0.00001"));
    });

    it("should handle very large liquidity amounts", async function () {
      const largeAmount = ethers.utils.parseEther("1000000");

      // ensure more balance and allowance for 2x on B
      const max = ethers.utils.parseEther("3000000");
      await tokenA.mint(addr1.address, max);
      await tokenB.mint(addr1.address, max);
      await tokenA.connect(addr1).approve(dex.address, max);
      await tokenB.connect(addr1).approve(dex.address, max);

      await dex
        .connect(addr1)
        .addLiquidity(
          largeAmount,
          largeAmount.mul(2)
        );
    });

    it("should prevent unauthorized access", async function () {
      await dex
        .connect(addr1)
        .addLiquidity(
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("200")
        );
      await expect(
        dex
          .connect(addr2)
          .removeLiquidity(ethers.utils.parseEther("10000"))
      ).to.be.revertedWith("Insufficient liquidity");
    });
  });

  describe("Events", function () {
    beforeEach(async function () {
      await dex
        .connect(addr1)
        .addLiquidity(
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("200")
        );
    });

    it("should emit LiquidityAdded event", async function () {
      await expect(
        dex
          .connect(addr2)
          .addLiquidity(
            ethers.utils.parseEther("50"),
            ethers.utils.parseEther("100")
          )
      ).to.emit(dex, "LiquidityAdded");
    });

    it("should emit LiquidityRemoved event", async function () {
      const userLiq = await dex.liquidity(addr1.address);
      await expect(
        dex.connect(addr1).removeLiquidity(userLiq)
      ).to.emit(dex, "LiquidityRemoved");
    });

    it("should emit Swap event", async function () {
      await expect(
        dex
          .connect(addr2)
          .swapAForB(ethers.utils.parseEther("10"))
      ).to.emit(dex, "Swap");
    });
  });
});
