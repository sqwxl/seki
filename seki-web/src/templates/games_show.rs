use askama::Template;

#[derive(Template)]
#[template(path = "games/show.html")]
pub struct GamesShowTemplate {
    pub game_id: i64,
    pub player_token: String,
    pub player_name: String,
    pub player_stone: i32,
    pub board_cols: i32,
    pub board_rows: i32,
    pub stage: String,
    pub is_player: bool,
    pub is_creator: bool,
    pub is_private: bool,
    pub has_open_slot: bool,
    pub chat_log_json: String,
}
