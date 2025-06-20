require "json"

module Go
  class Serializer
    class << self
      def serialize(engine)
        JSON.generate({
          ko: engine.goban.ko,
          captures: {B: engine.captures[:black], W: engine.captures[:white]},
          board: engine.board
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
