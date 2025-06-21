class Message < ApplicationRecord
  belongs_to :game
  belongs_to :player

  validates :text, presence: true

  def sender_label
    stone = case player
    when game.player_black then "B"
    when game.player_white then "W"
    else "S"
    end

    "#{stone} (#{player.username || "-"})"
  end
end
