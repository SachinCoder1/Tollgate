# quickstart — pay an x402 KeeperHub workflow in 60 seconds

```bash
git clone https://github.com/<org>/keepertoll
cd keepertoll && pnpm install
QUICKSTART_PRIVATE_KEY=0x… pnpm --filter @keepertoll/quickstart start
```

That's it. The script discovers paid workflows on our hosted gateway, pays
$0.02 USDC on Base Sepolia, calls the workflow, and prints the result + the
on-chain settlement tx hash. Source: [src/quickstart.ts](src/quickstart.ts).

To get a funded throwaway key:

1. Generate one: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`
2. Get Base Sepolia ETH (gas): https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet
3. Get Base Sepolia USDC: https://faucet.circle.com/ (chain: Base Sepolia)
4. Send both to the address derived from your key (any viem `privateKeyToAddress` snippet works).

The script costs $0.02 per run. Don't put a key with real funds here.
