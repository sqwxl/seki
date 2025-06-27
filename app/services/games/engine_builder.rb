module Games
  class EngineBuilder
    def self.call(game)
      moves = game.moves.map { |m| Go::Move.new(m.kind, m.stone, [m.col, m.row]) }
      Go::Engine.new(cols: game.cols, rows: game.rows, moves:)
    end
  end
end
