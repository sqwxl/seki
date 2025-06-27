class Game < ApplicationRecord
  belongs_to :creator, class_name: "Player"
  belongs_to :black, class_name: "Player", optional: true
  belongs_to :white, class_name: "Player", optional: true

  has_many :moves, dependent: :destroy
  has_many :messages, dependent: :destroy
  has_one :territory_review, dependent: :destroy, required: false

  validates :creator, presence: true
  validates :cols, :rows, numericality: {only_integer: true, greater_than_or_equal_to: 2}
  validates :komi, presence: true
  validates :handicap, numericality: {only_integer: true, greater_than_or_equal_to: 2}
  validates :result, absence: true, on: :create

  after_create_commit :send_invite_email, if: -> { white&.email.present? || black&.email.present? }

  def players
    [black, white]
  end

  def player_stone(player)
    raise "Player not part of game: #{player.inspect}" unless players.include? player

    case player
    when black then Go::Stone::BLACK
    when white then Go::Stone::WHITE
    end
  end

  def stage
    if moves.empty?
      Go::Stage::UNSTARTED
    elsif result
      Go::Stage::FINISHED
    elsif territory_review && !territory_review.settled
      Go::Stage::TERRITORY_REVIEW
    else
      Go::Stage::PLAY
    end
  end

  private

  def send_invite_email
    friend = (white == creator) ? black : white
    GameMailer.with(game: self, email: friend.email).invite.deliver_later
  end
end
