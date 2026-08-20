-- Correspondence turn emails: remind the active player once when their clock
-- enters the final 12 hours. last_seen tracks the remaining time as last
-- observed, so an undo that restores the clock re-arms the reminder.
alter table games add column corr_reminder_last_seen_ms integer;

-- Turn on correspondence email notifications for existing users.
update users
set preferences = json_set(preferences, '$.notify_your_turn_corr_email', json('true'));
