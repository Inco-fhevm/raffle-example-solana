import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";

// Program ID from the deployed contract
export const PROGRAM_ID = new PublicKey(
  "HY5CHkW7FEvCMdZLKrQ4w2Vr6krGtnJ1Kttd2WPqW9WC"
);

// Inco Lightning Program ID
export const INCO_LIGHTNING_PROGRAM_ID = new PublicKey(
  "5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj"
);

// IDL import
import idl from "./idl.json";

export type PrivateRaffleIDL = typeof idl;

export function getProgram(
  connection: Connection,
  wallet: AnchorProvider["wallet"]
) {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Program(idl as any, provider);
}

// PDA derivation functions
export function getRafflePDA(raffleId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("raffle"), raffleId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  );
}

export function getTicketPDA(
  raffle: PublicKey,
  buyer: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ticket"), raffle.toBuffer(), buyer.toBuffer()],
    PROGRAM_ID
  );
}

export function getVaultPDA(raffle: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), raffle.toBuffer()],
    PROGRAM_ID
  );
}

// Convert u128 handle to Buffer
export function handleToBuffer(handle: BN | bigint): Buffer {
  const bn = typeof handle === "bigint" ? new BN(handle.toString()) : handle;
  return bn.toArrayLike(Buffer, "le", 16);
}

// Raffle account type
export interface RaffleAccount {
  authority: PublicKey;
  raffleId: BN;
  ticketPrice: BN;
  participantCount: number;
  isOpen: boolean;
  prizeClaimed: boolean;
  winningNumberHandle: BN;
  bump: number;
}

// Ticket account type
export interface TicketAccount {
  raffle: PublicKey;
  owner: PublicKey;
  guessHandle: BN;
  isWinnerHandle: BN;
  claimed: boolean;
  bump: number;
}

export { SystemProgram };
