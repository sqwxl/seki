class AddPlayerWhitePlayerBlackToGames < ActiveRecord::Migration[8.0]
  def change
    add_column :games, :player_white_id, :integer
    add_column :games, :player_black_id, :integer
  end
end
