class CreateGames < ActiveRecord::Migration[8.0]
  def change
    create_table :games do |t|
      t.integer :cols, null: false, default: 19
      t.integer :rows, null: false, default: 19
      t.integer :handicap, null: false, default: 0
      t.float :komi, null: false, default: 0.5

      t.belongs_to :player_black, foreign_key: {to_table: :players}
      t.belongs_to :player_white, foreign_key: {to_table: :players}

      t.timestamps
    end

    create_table :moves do |t|
      t.belongs_to :game, null: false, foreign_key: true
      t.belongs_to :player, null: false, foreign_key: true

      t.integer :move_number, null: false

      t.string :kind, null: false, default: "play"

      t.integer :col, null: false
      t.integer :row, null: false

      t.timestamps
    end
  end
end
