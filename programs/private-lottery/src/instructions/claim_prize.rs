use anchor_lang::prelude::*;
use inco_lightning::{
    cpi::{self, accounts::{Allow, Operation}, e_select},
    program::IncoLightning,
    types::{Ebool, Euint128},
    ID as INCO_LIGHTNING_ID,
};
use crate::state::{Lottery, Ticket};
use crate::error::LotteryError;

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,
    
    pub lottery: Account<'info, Lottery>,
    
    #[account(mut)]
    pub ticket: Account<'info, Ticket>,
    
    /// CHECK: vault PDA
    #[account(mut, seeds = [b"vault", lottery.key().as_ref()], bump)]
    pub vault: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
    
    #[account(address = INCO_LIGHTNING_ID)]
    pub inco_lightning_program: Program<'info, IncoLightning>,
}

pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, ClaimPrize<'info>>) -> Result<()> {
    let ticket = &mut ctx.accounts.ticket;
    require!(ticket.owner == ctx.accounts.claimer.key(), LotteryError::NotOwner);
    require!(!ticket.claimed, LotteryError::AlreadyClaimed);
    require!(ticket.is_winner_handle != 0, LotteryError::NotChecked);

    let prize_amount = ctx.accounts.vault.lamports();
    
    let inco = ctx.accounts.inco_lightning_program.to_account_info();
    let signer = ctx.accounts.claimer.to_account_info();

    // Create encrypted prize amount
    let cpi_ctx = CpiContext::new(inco.clone(), Operation { signer: signer.clone() });
    let encrypted_prize: Euint128 = cpi::as_euint128(cpi_ctx, prize_amount as u128)?;

    // Create encrypted zero
    let cpi_ctx = CpiContext::new(inco.clone(), Operation { signer: signer.clone() });
    let zero: Euint128 = cpi::as_euint128(cpi_ctx, 0u128)?;

    // e_select: if winner, get prize; else get 0
    let cpi_ctx = CpiContext::new(inco.clone(), Operation { signer: signer.clone() });
    let actual_prize: Euint128 = e_select(
        cpi_ctx,
        Ebool(ticket.is_winner_handle),
        encrypted_prize,
        zero,
        0,
    )?;

    ticket.prize_handle = actual_prize.0;
    ticket.claimed = true;

    // Allow claimer to decrypt their prize amount
    if ctx.remaining_accounts.len() >= 2 {
        let cpi_ctx = CpiContext::new(inco, Allow {
            allowance_account: ctx.remaining_accounts[0].clone(),
            signer: signer.clone(),
            allowed_address: ctx.remaining_accounts[1].clone(),
            system_program: ctx.accounts.system_program.to_account_info(),
        });
        cpi::allow(cpi_ctx, actual_prize.0, true, ticket.owner)?;
    }

    msg!("Claim processed!");
    msg!("   Prize handle: {}", actual_prize.0);
    Ok(())
}
