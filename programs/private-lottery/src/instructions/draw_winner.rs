use anchor_lang::prelude::*;
use inco_lightning::{
    cpi::{self, accounts::Operation},
    program::IncoLightning,
    types::Euint128,
    ID as INCO_LIGHTNING_ID,
};
use crate::state::Lottery;
use crate::error::LotteryError;

#[derive(Accounts)]
pub struct DrawWinner<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub lottery: Account<'info, Lottery>,
    
    pub system_program: Program<'info, System>,
    
    #[account(address = INCO_LIGHTNING_ID)]
    pub inco_lightning_program: Program<'info, IncoLightning>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, DrawWinner<'info>>,
    encrypted_winning_number: Vec<u8>,
) -> Result<()> {
    let lottery = &mut ctx.accounts.lottery;
    require!(lottery.authority == ctx.accounts.authority.key(), LotteryError::Unauthorized);
    require!(lottery.is_open, LotteryError::LotteryClosed);

    lottery.is_open = false;

    // Create encrypted winning number (1-100)
    let inco = ctx.accounts.inco_lightning_program.to_account_info();
    let cpi_ctx = CpiContext::new(inco, Operation { signer: ctx.accounts.authority.to_account_info() });
    let winning_handle: Euint128 = cpi::new_euint128(cpi_ctx, encrypted_winning_number, 0)?;

    lottery.winning_number_handle = winning_handle.0;

    msg!("Winning number set!");
    msg!("   Handle: {}", winning_handle.0);
    msg!("   (Encrypted - nobody knows the winning number!)");
    Ok(())
}
