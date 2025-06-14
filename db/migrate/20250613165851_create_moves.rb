class CreateMoves < ActiveRecord::Migration[8.0]
  def change
    create_table :moves do |t|
      t.references :game, null: false, foreign_key: true
      t.integer :x
      t.integer :y
      t.string :color
      t.integer :move_number

      t.timestamps
    end
  end
end
