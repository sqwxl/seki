class Game < ApplicationRecord
  belongs_to :creator, class_name: "Player"
  belongs_to :black, class_name: "Player", optional: true
  belongs_to :white, class_name: "Player", optional: true

  has_many :messages, dependent: :destroy
  has_one :territory_review, dependent: :destroy, required: false

  has_many :moves, -> { order(:move_number) }, class_name: "GameMove", dependent: :destroy
  has_one :undo_request, dependent: :destroy, required: false


  # game settings
  after_initialize :set_default_size, if: :new_record?
  after_initialize :set_default_komi, if: :new_record?
  after_initialize :set_default_handicap, if: :new_record?
  after_initialize :set_invite_token, if: :new_record?

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
    if result
      Go::Status::Stage::DONE
    elsif moves.empty?
      Go::Status::Stage::UNSTARTED
    elsif territory_review && !territory_review.settled
      Go::Status::Stage::TERRITORY_REVIEW
    else
      Go::Status::Stage::PLAY
    end
  end

  def can_request_undo?(player)
    return false unless stage == Go::Status::Stage::PLAY
    return false unless players.include?(player)

    last_move = moves.order(:move_number).last
    return false unless last_move.kind.to_sym == Go::MoveKind::PLAY
    return false unless last_move.player == player
    return false if has_pending_undo_request?

    true
  end

  def has_pending_undo_request?
    undo_request&.pending?
  end

  def go_moves
    moves.map do |m|
      Go::Move.new(m.kind, m.stone, [m.col, m.row])
    end
  end

  private

  def set_default_size
    self.cols ||= cols || 19
    self.rows ||= rows || self.cols
  end

  def set_default_komi
    self.komi ||= komi || 0.5
  end

  def set_default_handicap
    self.handicap ||= handicap || 2
  end

  def set_invite_token
    self.invite_token = SecureRandom.uuid
  end

  def send_invite_email
    friend = (white == creator) ? black : white
    return unless friend&.email.present?
    GameMailer.with(game: self, email: friend.email, token: self.invite_token).invite.deliver_later
  end

end
