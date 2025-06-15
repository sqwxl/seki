class DropTablePlayers < ActiveRecord::Migration[8.0]
  def change
    drop_table :players
  end
end
