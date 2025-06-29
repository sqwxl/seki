# require_relative "../lib/go"

class Move < ApplicationRecord
  belongs_to :game
  belongs_to :player

  validates :game, :player, :stone, :kind, presence: true
  validates :kind, inclusion: { in: Go::MoveKind::ALL }

  after_initialize :set_move_number, if: :new_record?

  private

  def set_move_number
    self.move_number ||= game.moves.count
  end
end
