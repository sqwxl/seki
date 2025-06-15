class AddColsRowsHandicapKomiToGame < ActiveRecord::Migration[8.0]
  def change
    add_column :games, :cols, :integer
    add_column :games, :rows, :integer
    add_column :games, :handicap, :integer
    add_column :games, :komi, :float
  end
end
