class Game < ApplicationRecord
  has_many :moves, dependent: :destroy
  belongs_to :player_black, class_name: "Player", optional: true
  belongs_to :player_white, class_name: "Player", optional: true

  after_initialize :set_default_board_dimensions, if: :new_record?
  after_initialize :set_default_handicap, if: :new_record?
  after_initialize :set_default_komi, if: :new_record?

  def engine
    moves = self.moves.map do |move|
      Go::Move.new(move.kind, [move.col, move.row])
    end

    Go::Engine.new(cols: cols, rows: rows, moves: moves)
  end

  def players
    [player_black, player_white]
  end

  private

  def set_default_board_dimensions
    self.cols ||= 19
    self.rows ||= self.cols
  end

  def set_default_handicap
    self.handicap ||= 0
  end

  def set_default_komi
    self.komi ||= 0.5
  end
end
