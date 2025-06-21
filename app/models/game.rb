class Game < ApplicationRecord
  belongs_to :player_black, class_name: "Player", optional: true
  belongs_to :player_white, class_name: "Player", optional: true
  has_many :moves, dependent: :destroy
  has_many :messages, dependent: :destroy
  has_one :territory_review, dependent: :destroy, required: false

  after_initialize :set_default_board_dimensions, if: :new_record?
  after_initialize :set_default_handicap, if: :new_record?
  after_initialize :set_default_komi, if: :new_record?

  def engine
    moves = self.moves.map do |move|
      Go::Move.new(move.kind, move.stone, [move.col, move.row])
    end

    Go::Engine.new(cols: cols, rows: rows, moves: moves)
  end

  def players
    [player_black, player_white]
  end

  def player_stone(player)
    raise "Player not part of game: #{player.inspect}" unless players.include? player

    case player
    when player_black then Go::Stone::BLACK
    when player_white then Go::Stone::WHITE
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

  def set_default_board_dimensions
    self.cols ||= 19
    self.rows ||= self.cols
  end

  def set_default_handicap
    self.handicap ||= 2
  end

  def set_default_komi
    self.komi ||= 0.5
  end
end
