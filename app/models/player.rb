class Player < ApplicationRecord
  validates :session_token, allow_blank: true, uniqueness: true
  validates :email, allow_blank: true, uniqueness: true, format: URI::MailTo::EMAIL_REGEXP

  has_many :moves, class_name: "GameMove"
  has_many :games, ->(player) do
    unscope(:where).where(
      "black_id = :id OR white_id = :id",
      id: player.id
    )
  end, class_name: "Game"

  def ensure_session_token!
    return session_token if session_token.present?

    update!(session_token: SecureRandom.uuid)
    session_token
  end
end
