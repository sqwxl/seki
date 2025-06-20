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
  create_table "games", force: :cascade do |t|
    t.integer "cols", default: 19, null: false
    t.integer "rows", default: 19, null: false
    t.integer "handicap", default: 0, null: false
    t.float "komi", default: 0.5, null: false
    t.integer "player_black_id"
    t.integer "player_white_id"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["player_black_id"], name: "index_games_on_player_black_id"
    t.index ["player_white_id"], name: "index_games_on_player_white_id"
  end

  create_table "moves", force: :cascade do |t|
    t.integer "game_id", null: false
    t.integer "player_id", null: false
    t.integer "move_number", null: false
    t.string "kind", default: "play", null: false
    t.integer "col", null: false
    t.integer "row", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["game_id"], name: "index_moves_on_game_id"
    t.index ["player_id"], name: "index_moves_on_player_id"
  end

  create_table "players", force: :cascade do |t|
    t.string "session_token"
    t.string "email"
    t.string "name"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_players_on_email"
    t.index ["session_token"], name: "index_players_on_session_token"
  end

  add_foreign_key "games", "players", column: "player_black_id"
  add_foreign_key "games", "players", column: "player_white_id"
  add_foreign_key "moves", "games"
  add_foreign_key "moves", "players"
end
