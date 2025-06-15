class RemovePlayerIDsFromGames < ActiveRecord::Migration[8.0]
  def change
    remove_column :games, :player_1_id, :integer
    remove_column :games, :player_2_id, :integer
  end
end
