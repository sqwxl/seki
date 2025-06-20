class Player < ApplicationRecord
  validates :session_token, allow_blank: true, uniqueness: true
  validates :email, allow_blank: true, uniqueness: true, format: URI::MailTo::EMAIL_REGEXP

  has_many :moves
  has_many :games, ->(player) do
    unscope(:where).where(
      "player_black_id = :id OR player_white_id = :id",
      id: player.id
    )
  end, class_name: "Game"
end
