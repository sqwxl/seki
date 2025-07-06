module Go
  module EngineSerializer
    extend self

    def serialize(engine)
      {
        "ko" => engine.goban.ko.to_h,
        "captures" => engine.captures.to_h,
        "board" => engine.board,
        "stage" => engine.stage
      }
    end

    def deserialize(cols:, rows:, moves:, state:)
      # Create empty engine and restore cached state
      engine = Engine.new(cols: cols, rows: rows)
      engine.restore_state!(
        goban_state: {
          board: state["board"],
          captures: state["captures"],
          ko: state["ko"]
        },
        moves: moves
      )
      engine
    end
  end
end
