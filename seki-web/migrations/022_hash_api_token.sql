-- API tokens are stored hashed (sha256) in the api_token column, like the
-- one-time tokens; the raw value is shown once at generation. Existing
-- plaintext tokens are invalidated once — users regenerate from Settings.
update users set api_token = null where api_token is not null;
