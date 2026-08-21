-- API tokens expire after a year; the lookup rejects stale tokens and the
-- maintenance sweep clears them. Existing tokens count as freshly issued.
alter table users add column api_token_created_at text;

update users set api_token_created_at = current_timestamp
where api_token is not null and api_token_created_at is null;
