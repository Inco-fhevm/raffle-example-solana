use anchor_lang::prelude::*;
use inco_lightning::{
    cpi::{self, accounts::{Allow, Operation}},
    program::IncoLightning,
    types::Euint128,
    ID as INCO_LIGHTNING_ID,
};
use crate::state::{Lottery, Ticket};
use crate::error::LotteryError;

#[derive(Accounts)]
pub struct BuyTicket<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    
    #[account(mut)]
    pub lottery: Account<'info, Lottery>,
    
    #[account(
        init, 
        payer = buyer, 
        space = Ticket::SIZE,
        seeds = [b"ticket", lottery.key().as_ref(), buyer.key().as_ref()], 
        bump
    )]
    pub ticket: Account<'info, Ticket>,
    
    /// CHECK: vault PDA
    #[account(mut, seeds = [b"vault", lottery.key().as_ref()], bump)]
    pub vault: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
    
    #[account(address = INCO_LIGHTNING_ID)]
    pub inco_lightning_program: Program<'info, IncoLightning>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, BuyTicket<'info>>,
    encrypted_guess: Vec<u8>,
) -> Result<()> {
    let lottery = &mut ctx.accounts.lottery;
    require!(lottery.is_open, LotteryError::LotteryClosed);

    // Pay for ticket
    anchor_lang::solana_program::program::invoke(
        &anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.buyer.key(),
            &ctx.accounts.vault.key(),
            lottery.ticket_price,
        ),
        &[
            ctx.accounts.buyer.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    lottery.participant_count += 1;

    // Create encrypted guess handle
    let inco = ctx.accounts.inco_lightning_program.to_account_info();
    let cpi_ctx = CpiContext::new(inco.clone(), Operation { signer: ctx.accounts.buyer.to_account_info() });
    let guess_handle: Euint128 = cpi::new_euint128(cpi_ctx, encrypted_guess, 0)?;

    // Store ticket
    let ticket = &mut ctx.accounts.ticket;
    ticket.lottery = lottery.key();
    ticket.owner = ctx.accounts.buyer.key();
    ticket.guess_handle = guess_handle.0;
    ticket.bump = ctx.bumps.ticket;

    // Allow buyer to decrypt their guess
    if ctx.remaining_accounts.len() >= 2 {
        let cpi_ctx = CpiContext::new(inco, Allow {
            allowance_account: ctx.remaining_accounts[0].clone(),
            signer: ctx.accounts.buyer.to_account_info(),
            allowed_address: ctx.remaining_accounts[1].clone(),
            system_program: ctx.accounts.system_program.to_account_info(),
        });
        cpi::allow(cpi_ctx, guess_handle.0, true, ctx.accounts.buyer.key())?;
    }

    msg!("Ticket bought!");
    msg!("   Guess handle: {}", guess_handle.0);
    msg!("   (Your guess is encrypted - nobody can see it!)");
    Ok(())
}
