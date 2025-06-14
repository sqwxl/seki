class AddPlayersToGames < ActiveRecord::Migration[8.0]
  def change
    add_column :games, :player_1_id, :string
    add_column :games, :player_2_id, :string
  end
end
