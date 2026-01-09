use anchor_lang::prelude::*;
use crate::state::Lottery;

#[derive(Accounts)]
#[instruction(lottery_id: u64)]
pub struct CreateLottery<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        init, 
        payer = authority, 
        space = Lottery::SIZE,
        seeds = [b"lottery", lottery_id.to_le_bytes().as_ref()], 
        bump
    )]
    pub lottery: Account<'info, Lottery>,
    
    /// CHECK: vault PDA
    #[account(mut, seeds = [b"vault", lottery.key().as_ref()], bump)]
    pub vault: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateLottery>, lottery_id: u64, ticket_price: u64) -> Result<()> {
    let lottery = &mut ctx.accounts.lottery;
    lottery.authority = ctx.accounts.authority.key();
    lottery.lottery_id = lottery_id;
    lottery.ticket_price = ticket_price;
    lottery.participant_count = 0;
    lottery.is_open = true;
    lottery.winning_number_handle = 0;
    lottery.bump = ctx.bumps.lottery;

    msg!("Lottery {} created", lottery_id);
    msg!("   Ticket price: {} lamports", ticket_price);
    msg!("   Guess range: 1-100");
    Ok(())
}
