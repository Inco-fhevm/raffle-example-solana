"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useRaffle } from "@/hooks/useRaffle";
import { RaffleAccount, TicketAccount } from "@/lib/program";
import { encryptValue } from "@inco/solana-sdk/encryption"; 
import { TxStatus } from "@/components/tx-link";

export default function RaffleDetailPage() {
  const { id } = useParams();
  const wallet = useWallet();
  const {
    fetchRaffleByPDA,
    fetchTicket,
    buyTicket,
    checkWinner,
    drawWinner,
    decryptIsWinner,
    withdrawPrize,
    loading,
    error,
  } = useRaffle();

  const [raffle, setRaffle] = useState<RaffleAccount | null>(null);
  const [ticket, setTicket] = useState<TicketAccount | null>(null);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [isWinner, setIsWinner] = useState<boolean | null>(null);
  const [decrypting, setDecrypting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Store decrypt result for withdraw
  const [decryptResult, setDecryptResult] = useState<{
    plaintext: string;
    ed25519Instructions: unknown[];
    isWinnerHandle: string;
  } | null>(null);

  const rafflePDA = useMemo(
    () => (id ? new PublicKey(id as string) : null),
    [id]
  );

  const clearStatus = (delay = 8000) => {
    setTimeout(() => {
      setTxStatus(null);
      setLastTxHash(null);
      setIsSuccess(false);
    }, delay);
  };

  const refreshData = useCallback(async () => {
    if (!rafflePDA) return;

    const raffleData = await fetchRaffleByPDA(rafflePDA);
    setRaffle(raffleData);

    if (wallet.publicKey) {
      const ticketData = await fetchTicket(rafflePDA, wallet.publicKey);
      setTicket(ticketData);

      if (!ticketData) {
        setIsWinner(null);
        setDecryptResult(null);
      }
    } else {
      setTicket(null);
      setIsWinner(null);
      setDecryptResult(null);
    }
  }, [rafflePDA, fetchRaffleByPDA, fetchTicket, wallet.publicKey]);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      if (!rafflePDA) return;

      setPageLoading(true);
      const raffleData = await fetchRaffleByPDA(rafflePDA);
      if (!cancelled) setRaffle(raffleData);

      if (wallet.publicKey) {
        const ticketData = await fetchTicket(rafflePDA, wallet.publicKey);
        if (!cancelled) {
          setTicket(ticketData);
          setIsWinner(null);
          setDecryptResult(null);
        }
      } else {
        if (!cancelled) {
          setTicket(null);
          setIsWinner(null);
          setDecryptResult(null);
        }
      }
      if (!cancelled) setPageLoading(false);
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [rafflePDA, fetchRaffleByPDA, fetchTicket, wallet.publicKey]);

  const handlePurchase = async () => {
    if (!selectedNumber || !rafflePDA) return;

    setTxStatus("Encrypting guess...");
    setLastTxHash(null);
    setIsSuccess(false);

    try {
      const encrypted = await encryptValue(BigInt(selectedNumber));
      const encryptedBuffer = Buffer.from(encrypted.replace("0x", ""), "hex");

      setTxStatus("Submitting transaction...");
      const tx = await buyTicket(rafflePDA, encryptedBuffer);

      if (tx) {
        setTxStatus("Ticket purchased successfully!");
        setLastTxHash(tx);
        setIsSuccess(true);
        setSelectedNumber(null);
        await refreshData();
        clearStatus();
      }
    } catch (err) {
      console.error("Error purchasing ticket:", err);
      setTxStatus(null);
    }
  };

  const handleCheckWinner = async () => {
    if (!rafflePDA) return;

    setTxStatus("Simulating to get result handle...");
    setLastTxHash(null);
    setIsSuccess(false);

    const result = await checkWinner(rafflePDA);

    if (result) {
      setTxStatus("Encrypted comparison complete!");
      setLastTxHash(result.tx);
      await refreshData();

      // Now decrypt the result
      setDecrypting(true);
      setTxStatus("Decrypting result...");

      try {
        const decrypted = await decryptIsWinner(result.isWinnerHandle);

        if (decrypted) {
          setIsWinner(decrypted.isWinner);
          setDecryptResult({
            plaintext: decrypted.plaintext,
            ed25519Instructions: decrypted.ed25519Instructions,
            isWinnerHandle: result.isWinnerHandle.toString(),
          });

          if (decrypted.isWinner) {
            setTxStatus("🎉 Congratulations! You won!");
            setIsSuccess(true);
          } else {
            setTxStatus("Not a winner this time. Better luck next time!");
          }
        } else {
          setTxStatus("Could not decrypt result");
        }
      } catch (err) {
        console.error("Decrypt error:", err);
        setTxStatus("Decryption failed - check console");
      }

      setDecrypting(false);
      clearStatus(10000);
    }
  };

  const handleClaimPrize = async () => {
    if (!rafflePDA || !decryptResult) return;

    setTxStatus("Claiming prize...");
    setLastTxHash(null);
    setIsSuccess(false);

    const tx = await withdrawPrize(
      rafflePDA,
      decryptResult.isWinnerHandle,
      decryptResult.plaintext,
      decryptResult.ed25519Instructions
    );

    if (tx) {
      setTxStatus("🎉 Prize claimed successfully!");
      setLastTxHash(tx);
      setIsSuccess(true);
      await refreshData();
      setDecryptResult(null);
      clearStatus();
    }
  };

  const handleDrawWinner = async () => {
    if (!rafflePDA) return;

    setTxStatus("Drawing random winning number...");
    setLastTxHash(null);
    setIsSuccess(false);

    const tx = await drawWinner(rafflePDA);

    if (tx) {
      setTxStatus("Random winner drawn! (Encrypted - nobody knows yet)");
      setLastTxHash(tx);
      setIsSuccess(true);
      await refreshData();
      clearStatus();
    }
  };

  if (pageLoading) {
    return (
      <main className="pt-32 px-8 pb-20 max-w-6xl mx-auto">
        <div className="animate-pulse">
          <div className="h-4 bg-white/5 rounded w-24 mb-8" />
          <div className="h-12 bg-white/5 rounded w-1/2 mb-4" />
          <div className="h-6 bg-white/5 rounded w-1/3" />
        </div>
      </main>
    );
  }

  if (!raffle) {
    return (
      <main className="pt-32 px-8 pb-20 max-w-6xl mx-auto">
        <p className="text-white/40">Raffle not found</p>
        <Link
          href="/"
          className="text-[#3673F5] hover:underline mt-4 inline-block"
        >
          ← Back to raffles
        </Link>
      </main>
    );
  }

  const isAuthority =
    wallet.publicKey?.toBase58() === raffle.authority.toBase58();
  const ticketPrice = raffle.ticketPrice.toNumber() / LAMPORTS_PER_SOL;
  const hasCheckedWinner =
    ticket?.isWinnerHandle && !ticket.isWinnerHandle.isZero();

  return (
    <main className="pt-32 px-8 pb-20 max-w-6xl mx-auto">
      <Link
        href="/"
        className="text-white/40 text-sm mb-8 hover:text-white transition-colors flex items-center gap-2"
      >
        ← Back to raffles
      </Link>

      {(error || txStatus) && (
        <TxStatus
          status={error || txStatus || ""}
          txHash={lastTxHash}
          isError={!!error}
          isSuccess={isSuccess}
        />
      )}

      <div className="grid lg:grid-cols-2 gap-16">
        <div>
          <span
            className={`text-xs px-3 py-1 rounded-full border mb-6 inline-block ${
              raffle.isOpen
                ? "bg-[#3673F5]/10 text-[#3673F5] border-[#3673F5]/20"
                : "bg-white/5 text-white/40 border-white/10"
            }`}
          >
            {raffle.isOpen ? "Open for entries" : "Closed"}
          </span>

          <h1 className="text-5xl md:text-6xl font-light mb-4">
            Raffle #{raffle.raffleId.toString().slice(-6)}
          </h1>

          <p className="text-white/40 text-lg mb-8">
            {raffle.participantCount} participant
            {raffle.participantCount !== 1 ? "s" : ""} •{" "}
            {raffle.prizeClaimed ? "Prize claimed" : "Prize available"}
          </p>

          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-5xl font-light">{ticketPrice} SOL</span>
            <span className="text-white/30">per ticket</span>
          </div>

          {ticket ? (
            <div className="space-y-4">
              <div className="p-4 bg-[#3673F5]/10 border border-[#3673F5]/20 rounded-xl">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-white/60">Your Ticket</span>
                  <span className="text-[#3673F5]">
                    {hasCheckedWinner ? "Checked" : "Pending check"}
                  </span>
                </div>
                <p className="text-xs text-white/40 font-mono">
                  Guess: {ticket.guessHandle.toString().slice(0, 12)}...
                </p>
                {hasCheckedWinner && (
                  <p className="text-xs text-white/40 font-mono mt-1">
                    Result: {ticket.isWinnerHandle.toString().slice(0, 12)}...
                  </p>
                )}
              </div>

              {/* Winner Status Display */}
              {isWinner === true && (
                <div className="p-6 bg-green-500/10 border border-green-500/20 rounded-xl text-center">
                  <div className="text-4xl mb-2">🎉</div>
                  <h3 className="text-xl font-medium text-green-400 mb-2">
                    You Won!
                  </h3>
                  <p className="text-white/60 text-sm mb-4">
                    Your guess matched the random winning number!
                  </p>
                  {!raffle.prizeClaimed && decryptResult && (
                    <button
                      onClick={handleClaimPrize}
                      disabled={loading}
                      className="w-full px-6 py-3 bg-green-500 text-white text-sm font-medium rounded-full hover:bg-green-500/90 transition-all disabled:opacity-50"
                    >
                      {loading ? "Claiming..." : "Claim Prize"}
                    </button>
                  )}
                </div>
              )}

              {isWinner === false && (
                <div className="p-6 bg-white/5 border border-white/10 rounded-xl text-center">
                  <div className="text-4xl mb-2">😔</div>
                  <h3 className="text-xl font-medium text-white/60 mb-2">
                    Not a Winner
                  </h3>
                  <p className="text-white/40 text-sm">
                    The random number didn&apos;t match your guess. Better luck
                    next time!
                  </p>
                </div>
              )}

              {/* Check Winner Button */}
              {!raffle.isOpen && !hasCheckedWinner && (
                <button
                  onClick={handleCheckWinner}
                  disabled={loading || decrypting}
                  className="w-full px-4 py-3 bg-[#3673F5] text-white text-sm font-medium rounded-xl hover:bg-[#3673F5]/90 transition-all disabled:opacity-50"
                >
                  {loading || decrypting ? "Processing..." : "Check if You Won"}
                </button>
              )}

              {/* Decrypt again if already checked but no result yet */}
              {hasCheckedWinner && isWinner === null && (
                <button
                  onClick={handleCheckWinner}
                  disabled={loading || decrypting}
                  className="w-full px-4 py-3 bg-[#3673F5] text-white text-sm font-medium rounded-xl hover:bg-[#3673F5]/90 transition-all disabled:opacity-50"
                >
                  {decrypting ? "Decrypting..." : "Reveal Result"}
                </button>
              )}
            </div>
          ) : raffle.isOpen ? (
            <div className="p-4 bg-white/5 rounded-xl border border-white/10">
              <div className="flex justify-between items-center mb-4">
                <span className="text-white/60">
                  {selectedNumber
                    ? `Selected: #${selectedNumber}`
                    : "Select a number (1-100)"}
                </span>
                <span className="text-xl">{ticketPrice} SOL</span>
              </div>
              <button
                onClick={handlePurchase}
                disabled={!selectedNumber || loading}
                className={`w-full px-6 py-3 bg-white text-black text-sm font-medium rounded-full hover:bg-white/90 transition-all duration-300 ${
                  !selectedNumber || loading
                    ? "opacity-40 cursor-not-allowed"
                    : ""
                }`}
              >
                {loading ? "Processing..." : "Buy Ticket"}
              </button>
            </div>
          ) : (
            <div className="p-4 bg-white/5 rounded-xl border border-white/10">
              <p className="text-white/40 text-center">
                This raffle is closed for new entries
              </p>
            </div>
          )}

          {isAuthority && raffle.isOpen && raffle.participantCount > 0 && (
            <button
              onClick={handleDrawWinner}
              disabled={loading}
              className="mt-4 w-full px-6 py-3 bg-red-500/10 text-red-400 border border-red-500/20 text-sm font-medium rounded-xl hover:bg-red-500/20 transition-all disabled:opacity-50"
            >
              {loading ? "Drawing..." : "Draw Winner & Close Raffle"}
            </button>
          )}
        </div>

        {raffle.isOpen && !ticket && (
          <div>
            <h3 className="text-xs uppercase tracking-[0.2em] text-white/30 mb-8">
              Select Your Number (1-100)
            </h3>
            <div className="grid grid-cols-10 gap-1">
              {Array.from({ length: 100 }, (_, i) => i + 1).map((num) => {
                const isSelected = selectedNumber === num;

                return (
                  <button
                    key={num}
                    onClick={() => setSelectedNumber(num)}
                    className={`aspect-square rounded-lg text-xs font-medium transition-all duration-200 flex items-center justify-center ${
                      isSelected
                        ? "bg-[#3673F5] text-white scale-110 ring-2 ring-[#3673F5]/50"
                        : "bg-white/[0.02] text-white/40 border border-white/5 hover:border-[#3673F5]/50 hover:text-[#3673F5]"
                    }`}
                  >
                    {num}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-6 mt-6 text-xs text-white/40">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-white/[0.02] border border-white/5"></span>
                Available
              </span>
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-[#3673F5]"></span>
                Selected
              </span>
            </div>

            <p className="mt-6 text-xs text-white/30">
              Your guess is encrypted - no one can see it until the raffle ends!
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
