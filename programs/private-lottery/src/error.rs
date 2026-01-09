use anchor_lang::prelude::*;

#[error_code]
pub enum LotteryError {
    #[msg("Lottery is closed")]
    LotteryClosed,
    #[msg("Lottery is still open")]
    LotteryStillOpen,
    #[msg("No winning number set")]
    NoWinningNumber,
    #[msg("No participants")]
    NoParticipants,
    #[msg("Not ticket owner")]
    NotOwner,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Ticket not checked yet")]
    NotChecked,
    #[msg("Not claimed yet")]
    NotClaimed,
    #[msg("Not the winner")]
    NotWinner,
    #[msg("Unauthorized")]
    Unauthorized,
}
