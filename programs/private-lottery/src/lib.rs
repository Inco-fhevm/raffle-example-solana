#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("BoGG6xcmbV8HpsEA2qHs6pNUS5h5SfmNRvekf2g17PjB");

#[program]
pub mod private_lottery {
    use super::*;

    pub fn create_lottery(ctx: Context<CreateLottery>, lottery_id: u64, ticket_price: u64) -> Result<()> {
        instructions::create_lottery::handler(ctx, lottery_id, ticket_price)
    }

    pub fn buy_ticket<'info>(
        ctx: Context<'_, '_, '_, 'info, BuyTicket<'info>>,
        encrypted_guess: Vec<u8>,
    ) -> Result<()> {
        instructions::buy_ticket::handler(ctx, encrypted_guess)
    }

    pub fn draw_winner<'info>(
        ctx: Context<'_, '_, '_, 'info, DrawWinner<'info>>,
        encrypted_winning_number: Vec<u8>,
    ) -> Result<()> {
        instructions::draw_winner::handler(ctx, encrypted_winning_number)
    }

    pub fn check_winner<'info>(ctx: Context<'_, '_, '_, 'info, CheckWinner<'info>>) -> Result<()> {
        instructions::check_winner::handler(ctx)
    }

    pub fn claim_prize<'info>(ctx: Context<'_, '_, '_, 'info, ClaimPrize<'info>>) -> Result<()> {
        instructions::claim_prize::handler(ctx)
    }

    pub fn withdraw_prize(
        ctx: Context<WithdrawPrize>, 
        handle: Vec<u8>,
        plaintext: Vec<u8>,
    ) -> Result<()> {
        instructions::withdraw_prize::handler(ctx, handle, plaintext)
    }
}
