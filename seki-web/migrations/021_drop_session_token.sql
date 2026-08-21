-- Sessions become keyed by user id instead of a shared session_token stored
-- in plaintext on the user row (never rotated, valid from any browser once
-- leaked). Existing sessions are invalidated once; users simply
-- re-authenticate (and PWA app credentials restore them).
drop index idx_users_session_token;
alter table users drop column session_token;
