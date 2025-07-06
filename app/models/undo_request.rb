class UndoRequest < ApplicationRecord
  belongs_to :game
  belongs_to :requesting_player, class_name: "Player"
  belongs_to :target_move, class_name: "GameMove"
  belongs_to :responded_by, class_name: "Player", optional: true

  validates :status, inclusion: { in: UndoRequestStatus::ALL }
  validates :requesting_player, presence: true
  validates :target_move, presence: true
  validate :target_move_belongs_to_game
  validate :target_move_is_last_move
  validate :requesting_player_owns_target_move
  validate :game_allows_undo_request

  scope :pending, -> { where(status: UndoRequestStatus::PENDING) }
  scope :for_game, ->(game) { where(game: game) }

  def accept!(responding_player)
    raise "Undo request already responded to" unless pending?
    raise "Only opponent can respond to undo request" unless can_respond?(responding_player)

    update!(status: UndoRequestStatus::ACCEPTED, responded_by: responding_player)
    target_move.destroy!
  end

  def reject!(responding_player)
    raise "Undo request already responded to" unless pending?
    raise "Only opponent can respond to undo request" unless can_respond?(responding_player)

    update!(status: UndoRequestStatus::REJECTED, responded_by: responding_player)
  end

  def pending?
    status == UndoRequestStatus::PENDING
  end

  def accepted?
    status == UndoRequestStatus::ACCEPTED
  end

  def rejected?
    status == UndoRequestStatus::REJECTED
  end

  def can_respond?(player)
    game.players.include?(player) && player != requesting_player
  end

  private

  def target_move_belongs_to_game
    return unless target_move && game

    errors.add(:target_move, "must belong to the same game") unless target_move.game == game
  end

  def target_move_is_last_move
    return unless target_move && game

    last_move = game.moves.order(:move_number).last
    errors.add(:target_move, "must be the last move") unless target_move == last_move
  end

  def requesting_player_owns_target_move
    return unless target_move && requesting_player

    errors.add(:requesting_player, "must own the target move") unless target_move.player == requesting_player
  end

  def game_allows_undo_request
    return unless game

    errors.add(:game, "must be in play stage") unless game.stage == Go::Status::Stage::PLAY
    errors.add(:game, "must have at least one move") if game.moves.empty?
  end
end
