-- Per-device app visibility, so the server can skip pushing to devices whose
-- app is currently open. The SW-side client check is unreliable on iOS, and
-- silently dropping pushes there risks permission revocation.
alter table push_destinations add column visible integer not null default 0;
