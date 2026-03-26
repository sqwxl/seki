ALTER TABLE messages
ADD COLUMN client_message_id TEXT;

ALTER TABLE messages
ADD CONSTRAINT messages_game_user_client_message_id_key
UNIQUE (game_id, user_id, client_message_id);
