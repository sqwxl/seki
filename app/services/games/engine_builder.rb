module Games
  class EngineBuilder
    def self.call(game)
      move_count = game.moves.count

      # Check if we have cached state for current move count
      if move_count > 0 && game.cached_engine_state&.dig("move_count") == move_count
        return build_from_cache(game)
      end

      # Build engine from scratch and cache the result
      engine = build(game)
      cache_engine_state(game, engine, move_count)
      engine
    end

    private

    def self.build_from_cache(game)
      moves = game.moves.map do |m|
        Go::Move.new(m.kind, m.stone, [m.col, m.row])
      end

      Go::Engine.deserialize(
        cols: game.cols,
        rows: game.rows,
        moves: moves,
        state: game.cached_engine_state
      )
    end

    def self.build(game)
      Go::Engine.new(cols: game.cols, rows: game.rows, moves: game.go_moves)
    end

    def self.cache_engine_state(game, engine, move_count)
      cached_state = engine.serialize.merge(move_count: move_count)
      game.update_column(:cached_engine_state, cached_state)
    end
  end
end
