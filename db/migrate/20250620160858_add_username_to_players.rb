class AddUsernameToPlayers < ActiveRecord::Migration[8.0]
  def change
    remove_column :players, :name, :string
    add_column :players, :username, :string
  end
end
