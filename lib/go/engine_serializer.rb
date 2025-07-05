require "json"

module Go
  module EngineSerializer
    extend self

    def serialize(engine)
      {
        ko: engine.goban.ko.to_h,
        captures: engine.captures.to_h,
        board: engine.board,
        stage: engine.stage
      }
    end

    def deserialize(cols:, rows:, moves:, state:)
      # Create empty engine and restore cached state
      engine = Engine.new(cols: cols, rows: rows, moves: [])
      engine.restore_state!(
        goban_state: {
          board: state[:board],
          captures: state[:captures],
          ko: state[:ko]
        },
        moves: moves
      )
      engine
    end

    def restore_state!(goban_state:, moves:)
      @goban.restore_state!(
        board: goban_state[:board],
        captures: goban_state[:captures],
        ko: goban_state[:ko]
      )
      @moves = moves
    end
  end
end
