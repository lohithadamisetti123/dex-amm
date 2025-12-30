# DEX AMM Project

## Overview
Simplified Uniswap V2-style Decentralized Exchange using Automated Market Maker model with constant product formula (x * y = k). Supports liquidity provision/removal and token swaps with 0.3% trading fees.

## Features
- Initial and subsequent liquidity provision
- Liquidity removal with proportional share calculation
- Token swaps using constant product formula (x * y = k)
- 0.3% trading fee for liquidity providers
- LP token minting and burning
- Comprehensive test coverage (25+ tests)

## Architecture
Single DEX.sol contract manages:
- Internal LP token accounting via `totalLiquidity` and `liquidity[address]` mapping
- Reserve tracking with manual updates for precision
- Constant product formula with 0.3% fee (997/1000 multiplier)
- Integrated square root function for initial LP minting

## Mathematical Implementation

### Constant Product Formula
```
k = reserveA * reserveB
```
Swap calculation with 0.3% fee:
```
amountInWithFee = amountIn * 997 / 1000
amountOut = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee)
```

### Fee Calculation
0.3% fee applied to input before constant product calculation. Fee remains in pool, increasing `k` and benefiting LPs proportionally.

### LP Token Minting
- **Initial**: `sqrt(amountA * amountB)`
- **Subsequent**: `(amountA * totalLiquidity) / reserveA` (requires exact ratio match)

## Setup Instructions

### Prerequisites
- Docker and Docker Compose
- Git

### Installation
```
git clone <your-repo-url>
cd dex-amm
```

1. Start Docker: `docker-compose up -d`
2. Compile: `docker-compose exec app npm run compile`
3. Test: `docker-compose exec app npm test`
4. Coverage: `docker-compose exec app npm run coverage`
5. Stop: `docker-compose down`

## Running Tests Locally
```
npm install
npm run compile
npm test
```

## Contract Addresses
Deployed on Hardhat local network during tests.

## Known Limitations
- Single trading pair per DEX instance
- No slippage protection (bonus feature)
- Simplified LP token (internal accounting, not ERC20)

## Security Considerations
- Uses Solidity 0.8+ safe math
- Input validation on all functions
- Proper event emission
- Reentrancy-safe (external calls only after state updates)

## Test Results

![Hardhat test output](https://raw.githubusercontent.com/lohithadamisetti123/dex-amm/main/screenshots/tests.png)

![Coverage report](https://raw.githubusercontent.com/lohithadamisetti123/dex-amm/main/screenshots/coverage.png)
