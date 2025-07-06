# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.0].define(version: 2025_06_20_040532) do
  create_table "challenge", force: :cascade do |t|
    t.integer "game_id", null: false
    t.integer "challenger_id", null: false
    t.integer "challengee_id", null: false
    t.boolean "accepted"
    t.index ["challengee_id"], name: "index_challenge_on_challengee_id"
    t.index ["challenger_id"], name: "index_challenge_on_challenger_id"
    t.index ["game_id"], name: "index_challenge_on_game_id"
  end

  create_table "game_moves", force: :cascade do |t|
    t.integer "game_id", null: false
    t.integer "player_id", null: false
    t.integer "move_number", null: false
    t.string "kind", null: false
    t.integer "stone", null: false
    t.integer "col"
    t.integer "row"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["game_id"], name: "index_game_moves_on_game_id"
    t.index ["player_id"], name: "index_game_moves_on_player_id"
  end

  create_table "games", force: :cascade do |t|
    t.integer "creator_id"
    t.integer "black_id"
    t.integer "white_id"
    t.string "invite_token"
    t.integer "cols", null: false
    t.integer "rows", null: false
    t.float "komi", null: false
    t.integer "handicap", null: false
    t.boolean "is_private", default: false
    t.boolean "is_handicap", default: false
    t.datetime "started_at"
    t.datetime "ended_at"
    t.string "result"
    t.json "cached_engine_state"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["black_id"], name: "index_games_on_black_id"
    t.index ["creator_id"], name: "index_games_on_creator_id"
    t.index ["white_id"], name: "index_games_on_white_id"
  end

  create_table "messages", force: :cascade do |t|
    t.integer "game_id", null: false
    t.integer "player_id", null: false
    t.text "text", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["game_id"], name: "index_messages_on_game_id"
    t.index ["player_id"], name: "index_messages_on_player_id"
  end

  create_table "players", force: :cascade do |t|
    t.string "session_token"
    t.string "email"
    t.string "username"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_players_on_email"
    t.index ["session_token"], name: "index_players_on_session_token"
  end

  create_table "territory_reviews", force: :cascade do |t|
    t.integer "game_id", null: false
    t.boolean "black_approved", default: false
    t.boolean "white_approved", default: false
    t.boolean "settled", default: false
    t.json "black_dead_stones"
    t.json "white_dead_stones"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["game_id"], name: "index_territory_reviews_on_game_id"
  end

  create_table "undo_requests", force: :cascade do |t|
    t.integer "game_id", null: false
    t.integer "requesting_player_id", null: false
    t.integer "target_move_id", null: false
    t.string "status", default: "pending", null: false
    t.integer "responded_by_id"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["game_id"], name: "index_undo_requests_on_game_id", unique: true
    t.index ["requesting_player_id", "created_at"], name: "index_undo_requests_on_requesting_player_id_and_created_at"
    t.index ["requesting_player_id"], name: "index_undo_requests_on_requesting_player_id"
    t.index ["responded_by_id"], name: "index_undo_requests_on_responded_by_id"
    t.index ["target_move_id"], name: "index_undo_requests_on_target_move_id"
  end

  add_foreign_key "challenge", "games"
  add_foreign_key "challenge", "players", column: "challengee_id"
  add_foreign_key "challenge", "players", column: "challenger_id"
  add_foreign_key "game_moves", "games"
  add_foreign_key "game_moves", "players"
  add_foreign_key "games", "players", column: "black_id"
  add_foreign_key "games", "players", column: "creator_id"
  add_foreign_key "games", "players", column: "white_id"
  add_foreign_key "messages", "games"
  add_foreign_key "messages", "players"
  add_foreign_key "territory_reviews", "games"
  add_foreign_key "undo_requests", "game_moves", column: "target_move_id", on_delete: :cascade
  add_foreign_key "undo_requests", "games"
  add_foreign_key "undo_requests", "players", column: "requesting_player_id"
  add_foreign_key "undo_requests", "players", column: "responded_by_id"
end
