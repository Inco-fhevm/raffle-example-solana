"use client";

import { useCallback, useState, useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useProgram } from "./useProgram";
import {
  getRafflePDA,
  getTicketPDA,
  getVaultPDA,
  INCO_LIGHTNING_PROGRAM_ID,
  RaffleAccount,
  TicketAccount,
} from "@/lib/program";
import { decrypt } from "@inco/solana-sdk/attested-decrypt";
import { handleToBuffer, plaintextToBuffer } from "@inco/solana-sdk/utils";

// Derive allowance PDA from handle and allowed address
function deriveAllowancePda(
  handle: bigint,
  allowedAddress: PublicKey
): [PublicKey, number] {
  const buf = Buffer.alloc(16);
  let v = handle;
  for (let i = 0; i < 16; i++) {
    buf[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return PublicKey.findProgramAddressSync(
    [buf, allowedAddress.toBuffer()],
    INCO_LIGHTNING_PROGRAM_ID
  );
}

export function useRaffle() {
  const program = useProgram();
  const { connection } = useConnection();
  const wallet = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memoize wallet properties to avoid dependency issues
  const publicKey = useMemo(
    () => wallet?.publicKey ?? null,
    [wallet?.publicKey]
  );
  const signMessage = useMemo(
    () => wallet?.signMessage ?? null,
    [wallet?.signMessage]
  );
  const signTransaction = useMemo(
    () => wallet?.signTransaction ?? null,
    [wallet?.signTransaction]
  );

  // Fetch all raffles
  const fetchRaffles = useCallback(async (): Promise<
    { publicKey: PublicKey; account: RaffleAccount }[]
  > => {
    if (!program) return [];

    try {
      const accounts = await program.account.raffle.all();
      return accounts as unknown as {
        publicKey: PublicKey;
        account: RaffleAccount;
      }[];
    } catch (err) {
      console.error("Error fetching raffles:", err);
      return [];
    }
  }, [program]);

  // Fetch single raffle by ID
  const fetchRaffle = useCallback(
    async (
      raffleId: BN
    ): Promise<{ publicKey: PublicKey; account: RaffleAccount } | null> => {
      if (!program) return null;

      try {
        const [rafflePDA] = getRafflePDA(raffleId);
        const account = await program.account.raffle.fetch(rafflePDA);
        return {
          publicKey: rafflePDA,
          account: account as unknown as RaffleAccount,
        };
      } catch (err) {
        console.error("Error fetching raffle:", err);
        return null;
      }
    },
    [program]
  );

  // Fetch raffle by PDA
  const fetchRaffleByPDA = useCallback(
    async (rafflePDA: PublicKey): Promise<RaffleAccount | null> => {
      if (!program) return null;

      try {
        const account = await program.account.raffle.fetch(rafflePDA);
        return account as unknown as RaffleAccount;
      } catch (err) {
        console.error("Error fetching raffle:", err);
        return null;
      }
    },
    [program]
  );

  // Fetch user's ticket for a raffle
  const fetchTicket = useCallback(
    async (
      rafflePDA: PublicKey,
      owner: PublicKey
    ): Promise<TicketAccount | null> => {
      if (!program) return null;

      try {
        const [ticketPDA] = getTicketPDA(rafflePDA, owner);
        const account = await program.account.ticket.fetch(ticketPDA);
        return account as unknown as TicketAccount;
      } catch {
        return null;
      }
    },
    [program]
  );

  // Create a new raffle
  const createRaffle = useCallback(
    async (raffleId: BN, ticketPrice: BN): Promise<string | null> => {
      if (!program || !publicKey) {
        setError("Wallet not connected");
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const [rafflePDA] = getRafflePDA(raffleId);
        const [vaultPDA] = getVaultPDA(rafflePDA);

        const tx = await program.methods
          .createRaffle(raffleId, ticketPrice)
          .accounts({
            authority: publicKey,
            raffle: rafflePDA,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log("Raffle created:", tx);
        return tx;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        console.error("Error creating raffle:", err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [program, publicKey]
  );

  // Buy a ticket with encrypted guess
  const buyTicket = useCallback(
    async (
      rafflePDA: PublicKey,
      encryptedGuess: Buffer
    ): Promise<string | null> => {
      if (!program || !publicKey) {
        setError("Wallet not connected");
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const [ticketPDA] = getTicketPDA(rafflePDA, publicKey);
        const [vaultPDA] = getVaultPDA(rafflePDA);

        const tx = await program.methods
          .buyTicket(encryptedGuess)
          .accounts({
            buyer: publicKey,
            raffle: rafflePDA,
            ticket: ticketPDA,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
            // incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
          })
          .rpc();

        console.log("Ticket purchased:", tx);
        return tx;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        console.error("Error buying ticket:", err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [program, publicKey]
  );

  // Draw winner (authority only)
  const drawWinner = useCallback(
    async (rafflePDA: PublicKey): Promise<string | null> => {
      if (!program || !publicKey) {
        setError("Wallet not connected");
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const tx = await program.methods
          .drawWinner()
          .accounts({
            authority: publicKey,
            raffle: rafflePDA,
            systemProgram: SystemProgram.programId,
            // incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
          })
          .rpc();

        console.log("Winner drawn:", tx);
        return tx;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        console.error("Error drawing winner:", err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [program, publicKey]
  );

  // Get result handle from simulation logs
  const getHandleFromSimulation = useCallback(
    async (
      rafflePDA: PublicKey,
      prefix: string = "Result handle:"
    ): Promise<bigint | null> => {
      if (!program || !publicKey) return null;

      try {
        const [ticketPDA] = getTicketPDA(rafflePDA, publicKey);

        // Build the instruction
        const ix = await program.methods
          .checkWinner()
          .accounts({
            checker: publicKey,
            raffle: rafflePDA,
            ticket: ticketPDA,
            systemProgram: SystemProgram.programId,
            // incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
          })
          .instruction();

        const { blockhash } = await connection.getLatestBlockhash();

        // Create a VersionedTransaction for simulation (doesn't require signatures)
        const messageV0 = new TransactionMessage({
          payerKey: publicKey,
          recentBlockhash: blockhash,
          instructions: [ix],
        }).compileToV0Message();

        const versionedTx = new VersionedTransaction(messageV0);

        // Simulate without signatures
        const sim = await connection.simulateTransaction(versionedTx, {
          sigVerify: false,
        });

        console.log("Simulation logs:", sim.value.logs);

        if (sim.value.err) {
          console.log("Simulation error details:", sim.value.err);
        }

        for (const log of sim.value.logs || []) {
          if (log.includes(prefix)) {
            const match = log.match(/(\d+)/);
            if (match) return BigInt(match[1]);
          }
        }
        return null;
      } catch (err) {
        console.error("Simulation error:", err);
        return null;
      }
    },
    [program, publicKey, connection]
  );

  // Check if ticket is winner - with proper allowance setup
  const checkWinner = useCallback(
    async (
      rafflePDA: PublicKey
    ): Promise<{ tx: string; isWinnerHandle: bigint } | null> => {
      if (!program || !publicKey) {
        setError("Wallet not connected");
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const [ticketPDA] = getTicketPDA(rafflePDA, publicKey);

        // Step 1: Simulate to get the result handle
        console.log("Simulating to get result handle...");
        const resultHandle = await getHandleFromSimulation(rafflePDA);

        if (!resultHandle) {
          setError("Could not get result handle from simulation");
          return null;
        }

        console.log("Result handle from simulation:", resultHandle.toString());

        // Step 2: Derive allowance PDA
        const [allowancePda] = deriveAllowancePda(resultHandle, publicKey);
        console.log("Allowance PDA:", allowancePda.toBase58());

        // Step 3: Call checkWinner with remaining accounts for allowance
        const tx = await program.methods
          .checkWinner()
          .accounts({
            checker: publicKey,
            raffle: rafflePDA,
            ticket: ticketPDA,
            systemProgram: SystemProgram.programId,
            // incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
          })
          .remainingAccounts([
            { pubkey: allowancePda, isSigner: false, isWritable: true },
            { pubkey: publicKey, isSigner: false, isWritable: false },
          ])
          .rpc();

        console.log("Winner checked:", tx);

        return { tx, isWinnerHandle: resultHandle };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        console.error("Error checking winner:", err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [program, publicKey, getHandleFromSimulation]
  );

  // Decrypt is_winner_handle to check if user won
  const decryptIsWinner = useCallback(
    async (
      isWinnerHandle: bigint | BN
    ): Promise<{
      isWinner: boolean;
      plaintext: string;
      ed25519Instructions: unknown[];
    } | null> => {
      if (!publicKey || !signMessage) {
        setError("Wallet not connected or doesn't support signing");
        return null;
      }

      try {
        const handleStr =
          typeof isWinnerHandle === "bigint"
            ? isWinnerHandle.toString()
            : isWinnerHandle.toString();

        console.log("Decrypting handle:", handleStr);

        // Wait a bit for the chain to update
        await new Promise((r) => setTimeout(r, 2000));

        const result = await decrypt([handleStr], {
          address: publicKey,
          signMessage: signMessage,
        });

        console.log("Decryption result:", result);

        const isWinner = result.plaintexts[0] === "1";
        return {
          isWinner,
          plaintext: result.plaintexts[0] as string,
          ed25519Instructions: result.ed25519Instructions,
        };
      } catch (err) {
        console.error("Error decrypting:", err);
        return null;
      }
    },
    [publicKey, signMessage]
  );

  // Withdraw prize - requires ed25519 instructions from decrypt
  const withdrawPrize = useCallback(
    async (
      rafflePDA: PublicKey,
      isWinnerHandle: string,
      plaintext: string,
      ed25519Instructions: unknown[]
    ): Promise<string | null> => {
      if (!program || !publicKey || !signTransaction) {
        setError("Wallet not connected");
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const [ticketPDA] = getTicketPDA(rafflePDA, publicKey);
        const [vaultPDA] = getVaultPDA(rafflePDA);

        // Build withdraw instruction
        const withdrawIx = await program.methods
          .withdrawPrize(
            handleToBuffer(isWinnerHandle),
            plaintextToBuffer(plaintext)
          )
          .accounts({
            winner: publicKey,
            raffle: rafflePDA,
            ticket: ticketPDA,
            vault: vaultPDA,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
            // incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
          })
          .instruction();

        // Build transaction with ed25519 instructions first
        const tx = new Transaction();

        // Add ed25519 signature verification instructions
        ed25519Instructions.forEach((ix) => {
          tx.add(ix as Parameters<typeof tx.add>[0]);
        });

        // Add withdraw instruction
        tx.add(withdrawIx);

        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = publicKey;

        // Sign and send
        const signedTx = await signTransaction(tx);
        const sig = await connection.sendRawTransaction(signedTx.serialize());
        await connection.confirmTransaction(sig, "confirmed");

        console.log("Prize withdrawn:", sig);
        return sig;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        console.error("Error withdrawing prize:", err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [program, publicKey, signTransaction, connection]
  );

  return {
    program,
    loading,
    error,
    fetchRaffles,
    fetchRaffle,
    fetchRaffleByPDA,
    fetchTicket,
    createRaffle,
    buyTicket,
    drawWinner,
    checkWinner,
    decryptIsWinner,
    withdrawPrize,
  };
}
