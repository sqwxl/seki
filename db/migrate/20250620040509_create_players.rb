class CreatePlayers < ActiveRecord::Migration[8.0]
  def change
    create_table :players do |t|
      t.string :session_token, index: true
      t.string :email, index: true
      t.string :name

      t.timestamps
    end
  end
end
