class CreatePlayers < ActiveRecord::Migration[8.0]
  def change
    create_table :players do |t|
      t.string :session_token
      t.string :email

      t.timestamps
    end
    add_index :players, :session_token
  end
end
