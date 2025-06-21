class CreateGames < ActiveRecord::Migration[8.0]
  def change
    create_table :games do |t|
      t.integer :cols, null: false, default: 19
      t.integer :rows, null: false, default: 19

      t.float :komi, null: false, default: 0.5

      t.boolean :is_handicap, default: false
      t.integer :handicap, null: false, default: 2

      t.belongs_to :player_black, foreign_key: {to_table: :players}
      t.belongs_to :player_white, foreign_key: {to_table: :players}

      t.datetime :started_at
      t.datetime :ended_at

      t.string :result

      t.timestamps
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

    create_table :moves do |t|
      t.belongs_to :game, null: false, foreign_key: true
      t.belongs_to :player, null: false, foreign_key: true

      t.integer :move_number, null: false
      t.string :kind, null: false, default: Go::MoveKind::PLAY
      t.string :stone, null: false
      t.integer :col
      t.integer :row

      t.timestamps
    end
  end
end
