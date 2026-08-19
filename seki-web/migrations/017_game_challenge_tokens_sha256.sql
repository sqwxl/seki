-- O(1) lookup key for invite tokens. Resolving used to verify the token
-- against every outstanding argon2 hash — a scan that grew with each invite
-- and made every link click seconds slow. sha256 of a 256-bit random token
-- is equally irreversible, so it is both the key and the verification.
alter table game_challenge_tokens add column token_sha256 text;
alter table game_challenge_tokens drop column token_hash;

create unique index if not exists idx_game_challenge_tokens_sha256
    on game_challenge_tokens (token_sha256);
