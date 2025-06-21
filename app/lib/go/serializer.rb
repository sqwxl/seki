require "json"

module Go
  class Serializer
    class << self
      def serialize(engine)
        JSON.generate({
          ko: engine.goban.ko,
          captures: engine.captures,
          board: engine.board,
          status: engine.status,
          stage: engine.stage
        })
      end
    end
  end

  class Deserialize
    def initialize(str)
      # TODO, maybe
    end
  end
end
