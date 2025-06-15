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

ActiveRecord::Schema[8.0].define(version: 2025_06_14_160009) do
  create_table "games", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.integer "cols"
    t.integer "rows"
    t.integer "handicap"
    t.float "komi"
    t.integer "player_white_id"
    t.integer "player_black_id"
  end

  create_table "moves", force: :cascade do |t|
    t.integer "game_id", null: false
    t.integer "x"
    t.integer "y"
    t.string "color"
    t.integer "move_number"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["game_id"], name: "index_moves_on_game_id"
  end

  create_table "players", force: :cascade do |t|
    t.string "session_token"
    t.string "email"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["session_token"], name: "index_players_on_session_token"
  end

  add_foreign_key "moves", "games"
end
