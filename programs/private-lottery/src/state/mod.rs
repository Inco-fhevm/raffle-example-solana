use anchor_lang::prelude::*;

/// Lottery account
#[account]
pub struct Lottery {
    pub authority: Pubkey,
    pub lottery_id: u64,
    pub ticket_price: u64,
    pub participant_count: u32,
    pub is_open: bool,
    pub winning_number_handle: u128, // Encrypted winning number (1-100)
    pub bump: u8,
}

impl Lottery {
    pub const SIZE: usize = 8 + 32 + 8 + 8 + 4 + 1 + 16 + 1 + 32;
}

/// Ticket account
#[account]
pub struct Ticket {
    pub lottery: Pubkey,
    pub owner: Pubkey,
    pub guess_handle: u128,       // Encrypted guess (1-100)
    pub is_winner_handle: u128,   // Encrypted: guess == winning?
    pub prize_handle: u128,       // Encrypted prize amount
    pub claimed: bool,
    pub bump: u8,
}

impl Ticket {
    pub const SIZE: usize = 8 + 32 + 32 + 16 + 16 + 16 + 1 + 1 + 32;
}
