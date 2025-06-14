class Move < ApplicationRecord
  belongs_to :game

  validates :x, :y, :color, :move_number, presence: true
  validates :color, inclusion: { in: %w[black white] }
end
