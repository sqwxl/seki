class AddBoardSizeToGames < ActiveRecord::Migration[8.0]
  def change
    add_column :games, :board_size, :integer
  end
end
