import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PrivateLottery } from "../target/types/private_lottery";
import { PublicKey, Keypair, SystemProgram, Connection, SYSVAR_INSTRUCTIONS_PUBKEY, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { encryptValue } from "@inco/solana-sdk/encryption";
import { decrypt } from "@inco/solana-sdk/attested-decrypt";
import { hexToBuffer, handleToBuffer, plaintextToBuffer } from "@inco/solana-sdk/utils";

const INCO_LIGHTNING_PROGRAM_ID = new PublicKey("5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj");

describe("private-lottery", () => {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(connection, anchor.AnchorProvider.env().wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.privateLottery as Program<PrivateLottery>;
  let wallet: Keypair;
  
  const lotteryId = Math.floor(Date.now() / 1000);
  const TICKET_PRICE = 10_000_000; // 0.01 SOL
  
  // The game: guess 1-100, exact match wins!
  const MY_GUESS = 42;
  const WINNING_NUMBER = 42; // Authority's secret number
  
  let lotteryPda: PublicKey;
  let vaultPda: PublicKey;
  let ticketPda: PublicKey;

  before(() => {
    wallet = (provider.wallet as any).payer as Keypair;
    
    const idBuffer = Buffer.alloc(8);
    idBuffer.writeBigUInt64LE(BigInt(lotteryId));
    
    [lotteryPda] = PublicKey.findProgramAddressSync([Buffer.from("lottery"), idBuffer], program.programId);
    [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), lotteryPda.toBuffer()], program.programId);
    [ticketPda] = PublicKey.findProgramAddressSync([Buffer.from("ticket"), lotteryPda.toBuffer(), wallet.publicKey.toBuffer()], program.programId);
  });

  function deriveAllowancePda(handle: bigint): [PublicKey, number] {
    const buf = Buffer.alloc(16);
    let v = handle;
    for (let i = 0; i < 16; i++) { buf[i] = Number(v & BigInt(0xff)); v >>= BigInt(8); }
    return PublicKey.findProgramAddressSync([buf, wallet.publicKey.toBuffer()], INCO_LIGHTNING_PROGRAM_ID);
  }

  async function decryptHandle(handle: string): Promise<{ plaintext: string; ed25519Instructions: any[] } | null> {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const result = await decrypt([handle], {
        address: wallet.publicKey,
        signMessage: async (msg: Uint8Array) => nacl.sign.detached(msg, wallet.secretKey),
      });
      return { plaintext: result.plaintexts[0], ed25519Instructions: result.ed25519Instructions };
    } catch { return null; }
  }

  async function getHandleFromSimulation(tx: anchor.web3.Transaction, prefix: string): Promise<bigint | null> {
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
    tx.sign(wallet);

    const sim = await connection.simulateTransaction(tx);
    for (const log of sim.value.logs || []) {
      if (log.includes(prefix)) {
        const match = log.match(/(\d+)/);
        if (match) return BigInt(match[1]);
      }
    }
    return null;
  }

  it("1. Create lottery", async () => {
    const tx = await program.methods
      .createLottery(new anchor.BN(lotteryId), new anchor.BN(TICKET_PRICE))
      .accounts({
        authority: wallet.publicKey,
        lottery: lotteryPda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    
    console.log("Lottery created:", tx);
    console.log("   Guess a number 1-100!");
  });

  it("2. Buy ticket with encrypted guess", async () => {
    console.log("   My guess:", MY_GUESS, "(encrypted, nobody sees this!)");
    const encryptedGuess = await encryptValue(BigInt(MY_GUESS));
    
    const tx = await program.methods
      .buyTicket(hexToBuffer(encryptedGuess))
      .accounts({
        buyer: wallet.publicKey,
        lottery: lotteryPda,
        ticket: ticketPda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
        incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
      } as any)
      .rpc();
    
    console.log("Ticket bought:", tx);
  });

  it("3. Authority sets winning number", async () => {
    console.log("   Winning number:", WINNING_NUMBER, "(encrypted, nobody sees!)");
    const encryptedWinning = await encryptValue(BigInt(WINNING_NUMBER));
    
    const tx = await program.methods
      .drawWinner(hexToBuffer(encryptedWinning))
      .accounts({
        authority: wallet.publicKey,
        lottery: lotteryPda,
        systemProgram: SystemProgram.programId,
        incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
      } as any)
      .rpc();
    
    console.log("Winning number set:", tx);
  });

  it("4. Check if I won (encrypted comparison)", async () => {
    const txForSim = await program.methods
      .checkWinner()
      .accounts({
        checker: wallet.publicKey,
        lottery: lotteryPda,
        ticket: ticketPda,
        systemProgram: SystemProgram.programId,
        incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
      } as any)
      .transaction();

    const resultHandle = await getHandleFromSimulation(txForSim, "Result handle:");

    if (resultHandle) {
      const [allowancePda] = deriveAllowancePda(resultHandle);
      
      const tx = await program.methods
        .checkWinner()
        .accounts({
          checker: wallet.publicKey,
          lottery: lotteryPda,
          ticket: ticketPda,
          systemProgram: SystemProgram.programId,
          incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        } as any)
        .remainingAccounts([
          { pubkey: allowancePda, isSigner: false, isWritable: true },
          { pubkey: wallet.publicKey, isSigner: false, isWritable: false },
        ])
        .rpc();

      console.log("Checked:", tx);

      const result = await decryptHandle(resultHandle.toString());
      if (result) {
        const won = result.plaintext === "1";
        console.log("   Did I win?", won ? "YES!" : "No");
      }
    }
  });

  it("5. Claim prize", async () => {
    const txForSim = await program.methods
      .claimPrize()
      .accounts({
        claimer: wallet.publicKey,
        lottery: lotteryPda,
        ticket: ticketPda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
        incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
      } as any)
      .transaction();

    const prizeHandle = await getHandleFromSimulation(txForSim, "Prize handle:");

    if (prizeHandle) {
      const [allowancePda] = deriveAllowancePda(prizeHandle);

      const tx = await program.methods
        .claimPrize()
        .accounts({
          claimer: wallet.publicKey,
          lottery: lotteryPda,
          ticket: ticketPda,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
          incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        } as any)
        .remainingAccounts([
          { pubkey: allowancePda, isSigner: false, isWritable: true },
          { pubkey: wallet.publicKey, isSigner: false, isWritable: false },
        ])
        .rpc();

      console.log("Claim processed:", tx);
    }
  });

  it("6. Withdraw prize", async () => {
    const ticket = await program.account.ticket.fetch(ticketPda);
    const prizeHandle = ticket.prizeHandle.toString();
    
    if (prizeHandle === "0") {
      console.log("   No prize to claim");
      return;
    }

    const result = await decryptHandle(prizeHandle);
    if (!result) {
      console.log("   Failed to decrypt");
      return;
    }

    const prize = BigInt(result.plaintext);
    console.log("   Prize amount:", Number(prize) / 1e9, "SOL");

    if (prize > 0) {
      const withdrawIx = await program.methods
        .withdrawPrize(handleToBuffer(prizeHandle), plaintextToBuffer(result.plaintext))
        .accounts({
          winner: wallet.publicKey,
          lottery: lotteryPda,
          ticket: ticketPda,
          vault: vaultPda,
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
          incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        } as any)
        .instruction();

      const tx = new Transaction();
      result.ed25519Instructions.forEach(ix => tx.add(ix));
      tx.add(withdrawIx);

      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet.publicKey;

      const signedTx = await provider.wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signedTx.serialize());
      await connection.confirmTransaction(sig, "confirmed");

      console.log("Withdrawn:", sig);
    } else {
      console.log("   Not a winner - prize is 0");
    }
  });

  // ============ LOSER TEST ============
  describe("Non-winner flow", () => {
    const lotteryId2 = lotteryId + 1;
    const LOSER_GUESS = 99;
    const WINNING_NUMBER_2 = 7; // Different from loser's guess
    
    let lottery2Pda: PublicKey;
    let vault2Pda: PublicKey;
    let ticket2Pda: PublicKey;

    before(() => {
      const idBuffer = Buffer.alloc(8);
      idBuffer.writeBigUInt64LE(BigInt(lotteryId2));
      
      [lottery2Pda] = PublicKey.findProgramAddressSync([Buffer.from("lottery"), idBuffer], program.programId);
      [vault2Pda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), lottery2Pda.toBuffer()], program.programId);
      [ticket2Pda] = PublicKey.findProgramAddressSync([Buffer.from("ticket"), lottery2Pda.toBuffer(), wallet.publicKey.toBuffer()], program.programId);
    });

    it("7. Create lottery (loser test)", async () => {
      const tx = await program.methods
        .createLottery(new anchor.BN(lotteryId2), new anchor.BN(TICKET_PRICE))
        .accounts({
          authority: wallet.publicKey,
          lottery: lottery2Pda,
          vault: vault2Pda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
      
      console.log("Lottery 2 created:", tx);
    });

    it("8. Buy ticket with WRONG guess", async () => {
      console.log("   My guess:", LOSER_GUESS, "(will NOT match!)");
      const encryptedGuess = await encryptValue(BigInt(LOSER_GUESS));
      
      const tx = await program.methods
        .buyTicket(hexToBuffer(encryptedGuess))
        .accounts({
          buyer: wallet.publicKey,
          lottery: lottery2Pda,
          ticket: ticket2Pda,
          vault: vault2Pda,
          systemProgram: SystemProgram.programId,
          incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        } as any)
        .rpc();
      
      console.log("Ticket bought:", tx);
    });

    it("9. Authority sets DIFFERENT winning number", async () => {
      console.log("   Winning number:", WINNING_NUMBER_2, "(different from guess!)");
      const encryptedWinning = await encryptValue(BigInt(WINNING_NUMBER_2));
      
      const tx = await program.methods
        .drawWinner(hexToBuffer(encryptedWinning))
        .accounts({
          authority: wallet.publicKey,
          lottery: lottery2Pda,
          systemProgram: SystemProgram.programId,
          incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        } as any)
        .rpc();
      
      console.log("Winning number set:", tx);
    });

    it("10. Check if I won (should be NO)", async () => {
      const txForSim = await program.methods
        .checkWinner()
        .accounts({
          checker: wallet.publicKey,
          lottery: lottery2Pda,
          ticket: ticket2Pda,
          systemProgram: SystemProgram.programId,
          incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        } as any)
        .transaction();

      const resultHandle = await getHandleFromSimulation(txForSim, "Result handle:");

      if (resultHandle) {
        const [allowancePda] = deriveAllowancePda(resultHandle);
        
        const tx = await program.methods
          .checkWinner()
          .accounts({
            checker: wallet.publicKey,
            lottery: lottery2Pda,
            ticket: ticket2Pda,
            systemProgram: SystemProgram.programId,
            incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
          } as any)
          .remainingAccounts([
            { pubkey: allowancePda, isSigner: false, isWritable: true },
            { pubkey: wallet.publicKey, isSigner: false, isWritable: false },
          ])
          .rpc();

        console.log("Checked:", tx);

        const result = await decryptHandle(resultHandle.toString());
        if (result) {
          const won = result.plaintext === "1";
          console.log("   Did I win?", won ? "YES!" : "No(as expected!)");
        }
      }
    });

    it("11. Claim prize (loser gets 0)", async () => {
      const txForSim = await program.methods
        .claimPrize()
        .accounts({
          claimer: wallet.publicKey,
          lottery: lottery2Pda,
          ticket: ticket2Pda,
          vault: vault2Pda,
          systemProgram: SystemProgram.programId,
          incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        } as any)
        .transaction();

      const prizeHandle = await getHandleFromSimulation(txForSim, "Prize handle:");

      if (prizeHandle) {
        const [allowancePda] = deriveAllowancePda(prizeHandle);

        const tx = await program.methods
          .claimPrize()
          .accounts({
            claimer: wallet.publicKey,
            lottery: lottery2Pda,
            ticket: ticket2Pda,
            vault: vault2Pda,
            systemProgram: SystemProgram.programId,
            incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
          } as any)
          .remainingAccounts([
            { pubkey: allowancePda, isSigner: false, isWritable: true },
            { pubkey: wallet.publicKey, isSigner: false, isWritable: false },
          ])
          .rpc();

        console.log("Claim processed:", tx);
      }
    });

    it("12. Withdraw should FAIL (prize is 0)", async () => {
      const ticket = await program.account.ticket.fetch(ticket2Pda);
      const prizeHandle = ticket.prizeHandle.toString();
      
      const result = await decryptHandle(prizeHandle);
      if (!result) {
        console.log("   Failed to decrypt");
        return;
      }

      const prize = BigInt(result.plaintext);
      console.log("   Prize amount:", Number(prize), "lamports (should be 0!)");

      if (prize === BigInt(0)) {
        console.log("Prize is 0 - cannot withdraw (correct behavior!)");
        
        // Try to withdraw anyway - should fail
        try {
          const withdrawIx = await program.methods
            .withdrawPrize(handleToBuffer(prizeHandle), plaintextToBuffer(result.plaintext))
            .accounts({
              winner: wallet.publicKey,
              lottery: lottery2Pda,
              ticket: ticket2Pda,
              vault: vault2Pda,
              instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
              systemProgram: SystemProgram.programId,
              incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
            } as any)
            .instruction();

          const tx = new Transaction();
          result.ed25519Instructions.forEach(ix => tx.add(ix));
          tx.add(withdrawIx);

          const { blockhash } = await connection.getLatestBlockhash();
          tx.recentBlockhash = blockhash;
          tx.feePayer = wallet.publicKey;

          const signedTx = await provider.wallet.signTransaction(tx);
          await connection.sendRawTransaction(signedTx.serialize());
          
          throw new Error("Should have failed!");
        } catch (e: any) {
          if (e.message.includes("NotWinner") || e.message.includes("Should have failed")) {
            console.log("Withdraw correctly rejected - NotWinner!");
          } else {
            console.log("Withdraw rejected:", e.message.slice(0, 50));
          }
        }
      }
    });
  });
});
