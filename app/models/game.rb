class Game < ApplicationRecord
  has_many :moves, dependent: :destroy

  after_initialize :set_default_board_dimensions, if: :new_record?
  after_initialize :set_default_handicap, if: :new_record?
  after_initialize :set_default_komi, if: :new_record?

  private

  def set_default_board_dimensions
    self.cols ||= 19
    # TODO: support rectangular board
    self.rows = self.cols
  end

  def set_default_handicap
    self.handicap ||= 0
  end

  def set_default_komi
    self.komi ||= 0.5
  end
end
