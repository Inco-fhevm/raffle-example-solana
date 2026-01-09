use anchor_lang::prelude::*;
use inco_lightning::{
    cpi::{self, accounts::{Allow, Operation}},
    program::IncoLightning,
    types::{Ebool, Euint128},
    ID as INCO_LIGHTNING_ID,
};
use crate::state::{Lottery, Ticket};
use crate::error::LotteryError;

#[derive(Accounts)]
pub struct CheckWinner<'info> {
    #[account(mut)]
    pub checker: Signer<'info>,
    
    pub lottery: Account<'info, Lottery>,
    
    #[account(mut)]
    pub ticket: Account<'info, Ticket>,
    
    pub system_program: Program<'info, System>,
    
    #[account(address = INCO_LIGHTNING_ID)]
    pub inco_lightning_program: Program<'info, IncoLightning>,
}

pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, CheckWinner<'info>>) -> Result<()> {
    let lottery = &ctx.accounts.lottery;
    let ticket = &mut ctx.accounts.ticket;
    
    require!(!lottery.is_open, LotteryError::LotteryStillOpen);
    require!(lottery.winning_number_handle != 0, LotteryError::NoWinningNumber);

    let inco = ctx.accounts.inco_lightning_program.to_account_info();
    let cpi_ctx = CpiContext::new(inco.clone(), Operation { signer: ctx.accounts.checker.to_account_info() });
    
    // Encrypted comparison: guess == winning_number?
    let is_winner: Ebool = cpi::e_eq(
        cpi_ctx,
        Euint128(ticket.guess_handle),
        Euint128(lottery.winning_number_handle),
        0,
    )?;

    ticket.is_winner_handle = is_winner.0;

    // Allow ticket owner to see result
    if ctx.remaining_accounts.len() >= 2 {
        let cpi_ctx = CpiContext::new(inco, Allow {
            allowance_account: ctx.remaining_accounts[0].clone(),
            signer: ctx.accounts.checker.to_account_info(),
            allowed_address: ctx.remaining_accounts[1].clone(),
            system_program: ctx.accounts.system_program.to_account_info(),
        });
        cpi::allow(cpi_ctx, is_winner.0, true, ticket.owner)?;
    }

    msg!("Ticket checked!");
    msg!("   Result handle: {}", is_winner.0);
    Ok(())
}
