use anchor_lang::prelude::*;
use inco_lightning::{
    cpi::{self, accounts::VerifySignature},
    program::IncoLightning,
    ID as INCO_LIGHTNING_ID,
};
use crate::state::{Lottery, Ticket};
use crate::error::LotteryError;

#[derive(Accounts)]
pub struct WithdrawPrize<'info> {
    #[account(mut)]
    pub winner: Signer<'info>,
    
    pub lottery: Account<'info, Lottery>,
    
    #[account(mut)]
    pub ticket: Account<'info, Ticket>,
    
    /// CHECK: vault PDA - we need the bump to sign
    #[account(
        mut, 
        seeds = [b"vault", lottery.key().as_ref()], 
        bump
    )]
    pub vault: AccountInfo<'info>,
    
    /// CHECK: Instructions sysvar for Ed25519 signature verification
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
    
    #[account(address = INCO_LIGHTNING_ID)]
    pub inco_lightning_program: Program<'info, IncoLightning>,
}

pub fn handler(
    ctx: Context<WithdrawPrize>, 
    handle: Vec<u8>,
    plaintext: Vec<u8>,
) -> Result<()> {
    let ticket = &ctx.accounts.ticket;
    let lottery = &ctx.accounts.lottery;
    
    require!(ticket.owner == ctx.accounts.winner.key(), LotteryError::NotOwner);
    require!(ticket.claimed, LotteryError::NotClaimed);
    require!(ticket.prize_handle != 0, LotteryError::NotChecked);

    // Verify the decryption signature on-chain
    let cpi_ctx = CpiContext::new(
        ctx.accounts.inco_lightning_program.to_account_info(),
        VerifySignature {
            instructions: ctx.accounts.instructions.to_account_info(),
            signer: ctx.accounts.winner.to_account_info(),
        },
    );

    cpi::is_validsignature(
        cpi_ctx,
        1,
        Some(vec![handle]),
        Some(vec![plaintext.clone()]),
    )?;

    // Parse the verified plaintext to get prize amount
    let prize_amount = parse_plaintext_to_u64(&plaintext)?;
    
    require!(prize_amount > 0, LotteryError::NotWinner);

    // Transfer prize from vault PDA to winner
    let available = ctx.accounts.vault.lamports();
    let prize = available.min(prize_amount);
    
    // Use invoke_signed with vault PDA seeds
    let lottery_key = lottery.key();
    let vault_seeds: &[&[u8]] = &[
        b"vault",
        lottery_key.as_ref(),
        &[ctx.bumps.vault],
    ];
    
    anchor_lang::solana_program::program::invoke_signed(
        &anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.vault.key(),
            &ctx.accounts.winner.key(),
            prize,
        ),
        &[
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.winner.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[vault_seeds],
    )?;

    msg!("Prize withdrawn: {} lamports!", prize);
    Ok(())
}

fn parse_plaintext_to_u64(plaintext: &[u8]) -> Result<u64> {
    if plaintext.len() < 8 {
        let mut bytes = [0u8; 8];
        bytes[..plaintext.len()].copy_from_slice(plaintext);
        Ok(u64::from_le_bytes(bytes))
    } else {
        let bytes: [u8; 8] = plaintext[..8].try_into().unwrap();
        Ok(u64::from_le_bytes(bytes))
    }
}
