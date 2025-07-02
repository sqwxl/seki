module Go
  class Engine
    attr_reader :cols, :rows, :moves, :goban

    def initialize(cols:, rows: nil, moves: [], result: nil)
      @cols = cols
      @rows = rows || cols
      @moves = moves
      @result = result
      @goban = Goban.with_dimensions(cols: @cols, rows: @rows, moves: @moves)
    end

    def board
      @goban.mtrx
    end

    def ko
      @goban.ko
    end

    def captures
      @goban.captures
    end

    def stone_captures(stone)
      stone = Stone.normalize(stone)

      raise ArgumentError, "Invalid stone, EMPTY. Expected BLACK or WHITE" if stone == Stone::EMPTY

      @goban.captures[stone]
    end

    def current_turn_stone
      @moves.last.nil? ? Stone::BLACK : -@moves.last.stone
    end

    def stone_at(point)
      @goban.stone_at(point)
    end

    def try_play(stone, point)
      Rails.logger.debug "try_play: #{stone} @ #{point.inspect}, current stone: #{current_turn_stone}"
        raise Error::OutOfTurn unless stone == current_turn_stone

      # TODO: Lift game logic out of Goban class
      @goban = @goban.play(point, stone)
      @moves << Move.new(MoveKind::PLAY, stone, point)

      # TODO Add detection for when board is full

      stage
    end

    def try_pass(stone)
      raise Error::OutOfTurn unless stone == current_turn_stone
      
      @goban.pass! # TODO don't mutate
      @moves << Move.new(MoveKind::PASS, stone, nil)

      stage
    end

    def try_resign(stone)
      @result ||= "#{Stone.name(-stone)}+R"

      stage
    end

    def finish
    end

    def is_legal?(point)
      stone = current_turn_stone

      @goban.is_legal?(point, stone)
    end

    def stage
      Rails.logger.debug(@moves)
      if @moves.empty?
        Status::Stage::UNSTARTED
      elsif @result
        Status::Stage::DONE
      elsif @moves.length >= 2 && @moves[-2..].all? { |m| m.kind == MoveKind::PASS }
        Status::Stage::TERRITORY_REVIEW
      else
        Status::Stage::PLAY
      end
    end

    def serialize
      EngineSerializer.call(self)
    end

    def restore_state!(goban_state:, moves:)
      @goban.restore_state!(
        board: goban_state[:board],
        captures: goban_state[:captures],
        ko: goban_state[:ko]
      )
      @moves = moves
    end

    def self.deserialize(cols:, rows:, moves:, state:)
      # Create empty engine and restore cached state
      engine = new(cols: cols, rows: rows, moves: [])
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
