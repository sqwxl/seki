class CreateGames < ActiveRecord::Migration[8.0]
  def change
    create_table :players do |t|
      t.string :session_token, index: true
      t.string :email, index: true
      t.string :username

      t.timestamps
    end

    create_table :games do |t|
      t.belongs_to :creator, foreign_key: {to_table: :players}
      t.belongs_to :black, foreign_key: {to_table: :players}
      t.belongs_to :white, foreign_key: {to_table: :players}
      t.belongs_to :undo_requesting_player, null: true, foreign_key: {to_table: :players}

      t.string :invite_token

      t.integer :cols, null: false
      t.integer :rows, null: false
      t.float :komi, null: false
      t.integer :handicap, null: false
      t.boolean :is_private, default: false
      t.boolean :is_handicap, default: false

      t.datetime :started_at
      t.datetime :ended_at

      t.string :result
      t.json :cached_engine_state

      t.timestamps
    end

    create_table :challenge do |t|
      t.belongs_to :game, null: false, foreign_key: true
      t.belongs_to :challenger, null: false, foreign_key: {to_table: :players}
      t.belongs_to :challengee, null: false, foreign_key: {to_table: :players}
      t.boolean :accepted
    end

    create_table :territory_reviews do |t|
      t.references :game, null: false, foreign_key: true
      t.boolean :black_approved, default: false
      t.boolean :white_approved, default: false
      t.boolean :settled, default: false
      t.json :black_dead_stones
      t.json :white_dead_stones

      t.timestamps
    end

    create_table :game_moves do |t|
      t.belongs_to :game, null: false, foreign_key: true
      t.belongs_to :player, null: false, foreign_key: true

      t.integer :move_number, null: false
      t.string :kind, null: false
      t.integer :stone, null: false
      t.integer :col
      t.integer :row

      t.timestamps
    end

    create_table :messages do |t|
      t.references :game, null: false, foreign_key: true
      t.references :player, null: false, foreign_key: true
      t.text :text, null: false

      t.timestamps
    end
  end
end
