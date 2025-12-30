// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract DEX {
    address public immutable tokenA;
    address public immutable tokenB;
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public totalLiquidity;
    mapping(address => uint256) public liquidity;
    
    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidityMinted);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidityBurned);
    event Swap(address indexed trader, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);
    
    constructor(address _tokenA, address _tokenB) {
        tokenA = _tokenA;
        tokenB = _tokenB;
    }
    
    function addLiquidity(uint256 amountA, uint256 amountB) 
        external 
        returns (uint256 liquidityMinted) {
        require(amountA > 0 && amountB > 0, "Cannot add zero liquidity");
        
        IERC20(tokenA).transferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).transferFrom(msg.sender, address(this), amountB);
        
        if (totalLiquidity == 0) {
            // First liquidity provider
            liquidityMinted = sqrt(amountA * amountB);
            totalLiquidity = liquidityMinted;
        } else {
            // Subsequent liquidity providers must match ratio
            uint256 amountBOptimal = (amountA * reserveB) / reserveA;
            require(amountBOptimal == amountB, "Must match pool ratio");
            
            liquidityMinted = (amountA * totalLiquidity) / reserveA;
        }
        
        liquidity[msg.sender] += liquidityMinted;
        reserveA += amountA;
        reserveB += amountB;
        
        emit LiquidityAdded(msg.sender, amountA, amountB, liquidityMinted);
        return liquidityMinted;
    }
    
    function removeLiquidity(uint256 liquidityAmount) 
        external 
        returns (uint256 amountA, uint256 amountB) {
        require(liquidity[msg.sender] >= liquidityAmount, "Insufficient liquidity");
        require(liquidityAmount > 0, "Cannot remove zero liquidity");
        require(totalLiquidity > 0, "No liquidity in pool");
        
        amountA = (liquidityAmount * reserveA) / totalLiquidity;
        amountB = (liquidityAmount * reserveB) / totalLiquidity;
        
        require(amountA > 0 && amountB > 0, "Withdraw amounts too small");
        
        liquidity[msg.sender] -= liquidityAmount;
        totalLiquidity -= liquidityAmount;
        reserveA -= amountA;
        reserveB -= amountB;
        
        IERC20(tokenA).transfer(msg.sender, amountA);
        IERC20(tokenB).transfer(msg.sender, amountB);
        
        emit LiquidityRemoved(msg.sender, amountA, amountB, liquidityAmount);
        return (amountA, amountB);
    }
    
    function swapAForB(uint256 amountAIn) external returns (uint256 amountBOut) {
        require(amountAIn > 0, "Cannot swap zero amount");
        uint256 reserveAIn = reserveA;
        uint256 reserveBOut = reserveB;
        require(reserveAIn > 0 && reserveBOut > 0, "Pool not initialized");
        
        IERC20(tokenA).transferFrom(msg.sender, address(this), amountAIn);
        reserveA += amountAIn;
        
        amountBOut = getAmountOut(amountAIn, reserveAIn, reserveBOut);
        require(amountBOut > 0, "Insufficient output amount");
        
        reserveB -= amountBOut;
        IERC20(tokenB).transfer(msg.sender, amountBOut);
        
        emit Swap(msg.sender, tokenA, tokenB, amountAIn, amountBOut);
        return amountBOut;
    }
    
    function swapBForA(uint256 amountBIn) external returns (uint256 amountAOut) {
        require(amountBIn > 0, "Cannot swap zero amount");
        uint256 reserveBIn = reserveB;
        uint256 reserveAOut = reserveA;
        require(reserveBIn > 0 && reserveAOut > 0, "Pool not initialized");
        
        IERC20(tokenB).transferFrom(msg.sender, address(this), amountBIn);
        reserveB += amountBIn;
        
        amountAOut = getAmountOut(amountBIn, reserveBIn, reserveAOut);
        require(amountAOut > 0, "Insufficient output amount");
        
        reserveA -= amountAOut;
        IERC20(tokenA).transfer(msg.sender, amountAOut);
        
        emit Swap(msg.sender, tokenB, tokenA, amountBIn, amountAOut);
        return amountAOut;
    }
    
    function getPrice() external view returns (uint256 price) {
        require(reserveA > 0, "Reserve A is zero");
        return (reserveB * 1e18) / reserveA;
    }
    
    function getReserves() external view returns (uint256 _reserveA, uint256 _reserveB) {
        return (reserveA, reserveB);
    }
    
    function getAmountOut(uint256 amountAIn, uint256 reserveIn, uint256 reserveOut) 
        public 
        pure 
        returns (uint256 amountBOut) {
        require(amountAIn > 0, "Input amount must be > 0");
        require(reserveIn > 0 && reserveOut > 0, "Reserves must be > 0");
        
        uint256 amountInWithFee = (amountAIn * 997) / 1000; // 0.3% fee
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000) + amountInWithFee;
        amountBOut = numerator / denominator;
    }
    
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
