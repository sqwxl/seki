class Game < ApplicationRecord
  has_many :moves, dependent: :destroy

  after_initialize :set_default_board_size, if: :new_record?

  private

  def set_default_board_size
    self.board_size ||= 19
  end
end
