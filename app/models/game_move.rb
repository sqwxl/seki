class GameMove < ApplicationRecord
  belongs_to :game, inverse_of: :moves
  belongs_to :player

  validates_presence_of :game, :player, :stone, :kind
  validates_inclusion_of :kind, in: Go::MoveKind::ALL.map(&:to_s)
  validate :coordinates_within_board_bounds

  after_initialize :set_move_number, if: :new_record?

  private

  def set_move_number
    self.move_number ||= game&.moves&.count || 0
  end

  def coordinates_within_board_bounds
    return unless game && (col.present? || row.present?)
    
    if col.present? && (col < 0 || col >= game.cols)
      errors.add(:col, "must be within board bounds (0 to #{game.cols - 1})")
    end
    
    if row.present? && (row < 0 || row >= game.rows)
      errors.add(:row, "must be within board bounds (0 to #{game.rows - 1})")
    end
  end
end
