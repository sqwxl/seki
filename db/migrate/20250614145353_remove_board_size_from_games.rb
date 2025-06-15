class RemoveBoardSizeFromGames < ActiveRecord::Migration[8.0]
  def change
    remove_column :games, :board_size, :integer
  end
end
