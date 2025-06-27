class Message < ApplicationRecord
  belongs_to :game
  belongs_to :player

  validates :text, presence: true

  def sender_label
    stone = case player
    when game.black then "B"
    when game.white then "W"
    else "S"
    end

    "#{stone} (#{player.username || "-"})"
  end
end
