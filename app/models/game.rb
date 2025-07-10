class Game < ApplicationRecord
  belongs_to :creator, class_name: "Player"
  belongs_to :black, class_name: "Player", optional: true
  belongs_to :white, class_name: "Player", optional: true
  belongs_to :undo_requesting_player, class_name: "Player", optional: true

  has_many :messages, dependent: :destroy
  has_one :territory_review, dependent: :destroy, required: false

  has_many :moves, -> { order(:move_number) }, class_name: "GameMove", dependent: :destroy

  scope :with_players, -> { includes(:black, :white, :creator, :undo_requesting_player) }

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

  def current_turn_stone
    last_move = moves.order(:move_number).last
    return Go::Stone::BLACK if last_move.nil? # Black starts
    -last_move.stone # Opposite of last move's stone
  end

  def current_turn_player
    return nil unless stage == Go::Status::Stage::PLAY
    stone = current_turn_stone
    case stone
    when Go::Stone::BLACK then black
    when Go::Stone::WHITE then white
    end
  end

  def can_request_undo?(player)
    return false unless stage == Go::Status::Stage::PLAY
    return false unless players.include?(player)

    last_move = moves.order(:move_number).last
    return false unless last_move # No moves yet
    return false unless last_move.kind.to_sym == Go::MoveKind::PLAY
    return false unless last_move.player == player # Can only undo your own move
    return false if current_turn_player == player # Can't undo on your turn
    return false if has_pending_undo_request?
    return false if last_move.id == last_rejected_move_id # Can't re-request same move

    true
  end

  def has_pending_undo_request?
    undo_requesting_player.present?
  end

  def request_undo!(player)
    raise "Cannot request undo at this time" unless can_request_undo?(player)

    update!(undo_requesting_player: player)
  end

  def accept_undo!(responding_player)
    raise "No pending undo request" unless has_pending_undo_request?
    raise "Only opponent can respond to undo request" unless can_respond_to_undo?(responding_player)

    # Delete the last move (which must belong to the requesting player)
    last_move = moves.order(:move_number).last
    last_move.destroy!

    # Clear the undo request
    update!(undo_requesting_player: nil)
  end

  def reject_undo!(responding_player)
    raise "No pending undo request" unless has_pending_undo_request?
    raise "Only opponent can respond to undo request" unless can_respond_to_undo?(responding_player)

    track_rejection!
    update!(undo_requesting_player: nil)
  end

  def can_respond_to_undo?(player)
    return false unless has_pending_undo_request?
    players.include?(player) && player != undo_requesting_player
  end

  def create_move!(player:, kind:, stone:, col: nil, row: nil)
    # Clear any pending undo request when a move is made
    update!(undo_requesting_player: nil) if has_pending_undo_request?

    # Create the move
    moves.create!(
      player: player,
      stone: stone,
      move_number: moves.count,
      kind: kind,
      col: col,
      row: row
    )
  end

  def go_moves
    moves.map do |m|
      Go::Move.new(m.kind, m.stone, [m.col, m.row])
    end
  end

  def last_rejected_move_id
    cached_engine_state&.dig("rejected_move_id")&.to_i
  end

  private

  def track_rejection!
    last_move = moves.order(:move_number).last
    return unless last_move

    engine = Games::EngineBuilder.call(self)
    Games::EngineBuilder.cache_engine_state(
      self, engine, moves.count,
      metadata: {rejected_move_id: last_move.id}
    )
  end

  def set_default_size
    self.cols ||= 19
    self.rows ||= self.cols
  end

  def set_default_komi
    self.komi ||= 0.5
  end

  def set_default_handicap
    self.handicap ||= 2
  end

  def set_invite_token
    self.invite_token = SecureRandom.alphanumeric
  end

  def send_invite_email
    friend = (white == creator) ? black : white
    return unless friend&.email.present?
    GameMailer.with(game: self, email: friend.email, token: invite_token).invite.deliver_later
  end
end
