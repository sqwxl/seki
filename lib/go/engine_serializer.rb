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
      goban = Goban.from_state(board: state["board"], captures: state["captures"], ko: state["ko"])

      engine = Engine.new(cols: cols, rows: rows, moves: moves)
      engine.instance_variable_set(:@goban, goban)
      engine
    end
  end
end
