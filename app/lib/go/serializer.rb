require "json"

module Go
  class EngineSerializer
    def self.call(engine)
      {
        ko: engine.goban.ko.to_h,
        captures: engine.captures.to_h,
        board: engine.board,
        status: engine.status,
        stage: engine.stage
      }
    end
  end
end
