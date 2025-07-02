class GameMove < ApplicationRecord
  belongs_to :game, inverse_of: :moves
  belongs_to :player

  validates_presence_of :game, :player, :stone, :kind
  validates_inclusion_of :kind, in: Go::MoveKind::ALL.map(&:to_s)

  after_initialize :set_move_number, if: :new_record?

  private

  def set_move_number
    self.move_number ||= game&.moves&.count || 0
  end
end
