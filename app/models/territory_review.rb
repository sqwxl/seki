class TerritoryReview < ApplicationRecord
  belongs_to :game
  validates :game, uniqueness: true
end
