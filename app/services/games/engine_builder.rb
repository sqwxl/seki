module Games
  class EngineBuilder
    def self.call(game)
      moves = game.moves.map do |m|
        Go::Move.new(m.kind, m.stone, [ m.col, m.row ])
      end
      Go::Engine.new(cols: game.cols, rows: game.rows, moves:)
    end
  end
end
