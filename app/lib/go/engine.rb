module Go
  class Engine
    attr_reader :cols, :rows, :moves

    def initialize(cols:, rows:, moves:)
      @cols = cols
      @rows = rows
      @moves = moves
      # build internal board representation here if needed
    end

    def legal_move?(x, y)
      # Basic logic: can't play where a stone already exists
      # TODO: Prevent auto-death and ko
      # TODO: Account for captures
      !moves.any? { |m| m.x == x && m.y == y }
    end

    def current_turn_color
      moves.size.even? ? "black" : "white"
    end

    # Add more game logic here: capturing, ko rule, scoring, etc.
  end
end
