# Private Raffle

A confidential raffle system built on Solana using Inco Lightning rust SDK for encrypted compute on Solana. Players submit encrypted guesses, and the winning number remains hidden until verification, ensuring complete privacy throughout the game.

## Overview

This program implements a simple number-guessing raffle (1-100) where:

- Player guesses are encrypted and hidden from everyone
- The winning number is encrypted and hidden from everyone
- Winner determination happens through encrypted comparison
- Only the ticket owner can decrypt their result

## Architecture

### Privacy Model

| Data | Visibility |
|------|------------|
| Player's guess | Encrypted (only player can decrypt) |
| Winning number | Encrypted (set by authority) |
| Win/loss result | Encrypted (only ticket owner can decrypt) |
| Prize amount | Encrypted (only ticket owner can decrypt) |

### Program Flow

```
1. create_raffle    -> Authority creates raffle with ticket price
2. buy_ticket        -> Player submits encrypted guess (1-100)
3. draw_winner       -> Authority sets encrypted winning number
4. check_winner      -> Encrypted comparison: guess == winning_number
5. claim_prize       -> e_select(is_winner, prize, 0) computes encrypted prize
6. withdraw_prize    -> On-chain signature verification, transfer if prize > 0
```

### Key Encrypted Operations

- `new_euint128`: Create encrypted value from ciphertext
- `e_eq`: Encrypted equality comparison
- `e_select`: Encrypted conditional selection
- `allow`: Grant decryption permission to specific address
- `is_validsignature`: Verify decryption proof on-chain

## Account Structures

### Raffle

```rust
pub struct Raffle {
    pub authority: Pubkey,
    pub raffle_id: u64,
    pub ticket_price: u64,
    pub participant_count: u32,
    pub is_open: bool,
    pub prize_claimed: bool,                // True when a winner has withdrawn
    pub winning_number_handle: u128,        // Encrypted winning number (1-100)
    pub bump: u8,
}
```

### Ticket

```rust
pub struct Ticket {
    pub raffle: Pubkey,
    pub owner: Pubkey,
    pub guess_handle: u128,       // Encrypted guess (1-100)
    pub is_winner_handle: u128,   // Encrypted: guess == winning?
    pub claimed: bool,            // Whether this ticket holder has withdrawn
    pub bump: u8,
}
```

## Prerequisites

- Rust 1.70+
- Solana CLI 1.18+
- Anchor 0.31.1
- Node.js 18+
- Yarn

## Installation

```bash
# Clone repository
git clone https://github.com/Inco-fhevm/raffle-example-solana
cd raffle-example-solana

# Install dependencies
yarn install

# Build program
anchor build
```

## Deployment

```bash
# Get program keypair address
solana address -k target/deploy/keypair.json

# Update program ID in lib.rs and Anchor.toml with the address above

# Rebuild with correct program ID
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet
```

## Testing

```bash
# Run tests (after deployment)
anchor test --skip-deploy
```

### Test Scenarios

The test suite covers two scenarios:

1. **Winner Flow**: Player guesses correctly and withdraws prize
2. **Non-Winner Flow**: Player guesses incorrectly and withdrawal fails

## Usage

### Client Integration

```typescript
import { encryptValue } from "@inco/solana-sdk/encryption";
import { decrypt } from "@inco/solana-sdk/attested-decrypt";
import { hexToBuffer } from "@inco/solana-sdk/utils";

// Encrypt guess
const myGuess = 42;
const encryptedGuess = await encryptValue(BigInt(myGuess));

// Buy ticket
await program.methods
  .buyTicket(hexToBuffer(encryptedGuess))
  .accounts({...})
  .rpc();

// Decrypt result after checking
const result = await decrypt([resultHandle], {
  address: wallet.publicKey,
  signMessage: async (msg) => nacl.sign.detached(msg, wallet.secretKey),
});

const isWinner = result.plaintexts[0] === "1";
```

### Allow Pattern for Decryption

To decrypt encrypted values, the program must grant permission via the `allow` instruction. This is done through remaining accounts:

```typescript
const [allowancePda] = PublicKey.findProgramAddressSync(
  [handleBuffer, walletPublicKey.toBuffer()],
  INCO_LIGHTNING_PROGRAM_ID
);

await program.methods
  .checkWinner()
  .accounts({...})
  .remainingAccounts([
    { pubkey: allowancePda, isSigner: false, isWritable: true },
    { pubkey: wallet.publicKey, isSigner: false, isWritable: false },
  ])
  .rpc();
```

### On-Chain Verification

Prize withdrawal requires on-chain verification of the decryption proof:

```typescript
const result = await decrypt([prizeHandle], {...});

// Build transaction with Ed25519 signature + withdraw instruction
const tx = new Transaction();
result.ed25519Instructions.forEach(ix => tx.add(ix));
tx.add(withdrawInstruction);
```

## Dependencies

### Rust

```toml
[dependencies]
anchor-lang = "0.31.1"
inco-lightning = { version = "0.1.4", features = ["cpi"] }
```

## Setting up Frontend:

Navigate to the app folder:

```bash
cd app
```
Install the dependencies:
```bash
bun install
```

Start the app:

```bash
bun run dev
```

The app will start on localhost:3000





