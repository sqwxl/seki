module Go
  class Engine
    attr_reader :cols, :rows, :moves, :goban

    def initialize(cols:, rows: nil, moves: [], result: nil)
      @cols = cols
      @rows = rows
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
      moves.last.nil? ? BLACK : -moves.last.stone
    end

    def stone_at(point)
      @goban.stone_at(point)
    end

    def try_play(stone, point)
      begin
        @goban = @goban.play(point, stone)
        @moves << Move.new(MoveKind::PLAY, stone, point)

        # TODO Add detection for when board is full
      rescue Go::Error
        puts "[Go::Engine] #{e.message}"

        return false
      end

      true
    end

    def try_pass(stone)
      @goban.pass! # TODO don't mutate
      @moves << Move.new(MoveKind::PASS, stone)

      stage
    end

    def try_resign(stone)
      @result ||= "#{Stone.to_s(-stone)}+R"

      stage
    end

    def finish
    end

    def is_legal?(point)
      stone = current_turn_stone

      @goban.is_legal?(point, stone)
    end

    def status
      # TODO
    end

    def stage
      if @moves.length == 0
        Stage::UNSTARTED
      elsif !@result.nil?
        Stage::FINISHED
      elsif @moves.last.kind == MoveKind::PLAY
        Stage::PLAY
      elsif @moves.length > 1 && @moves[-2..2].all? { |m| m.kind == MoveKind::PASS }
        Stage::TERRITORY_REVIEW
      end
    end

    def serialize
      Serializer.serialize(self)
    end
  end
end
