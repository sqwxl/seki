use argon2::password_hash::SaltString;
use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};

use crate::error::AppError;

pub(crate) fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn hash_token(token: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(token.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Token hash error: {e}")))?
        .to_string())
}

pub(crate) fn verify_token(token: &str, token_hash: &str) -> bool {
    PasswordHash::new(token_hash)
        .map(|parsed| {
            Argon2::default()
                .verify_password(token.as_bytes(), &parsed)
                .is_ok()
        })
        .unwrap_or(false)
}
