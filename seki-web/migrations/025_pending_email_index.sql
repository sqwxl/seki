-- The invite lookup scans users by email OR pending_email; the confirmed
-- email index can't serve the pending side.
create index if not exists idx_users_pending_email on users (pending_email);
