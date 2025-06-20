class Move < ApplicationRecord
  belongs_to :game
  belongs_to :player

  validates :move_number, :kind, :col, :row, presence: true
end
