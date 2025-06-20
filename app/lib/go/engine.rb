module Go
  class Engine
    attr_reader :cols, :rows, :moves, :goban

    def initialize(cols:, rows: nil, moves: [])
      @cols = cols
      @rows = rows
      @moves = moves
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
      moves.length.even? ? Stone::BLACK : Stone::WHITE
    end

    def stone_at(point)
      @goban.stone_at(point)
    end

    def try_play(point)
      begin
        stone = current_turn_stone

        @goban = @goban.play(point, stone)
        @moves << Move.new(MoveKind::PLAY, point)

        # TODO Add detection for when board is full
      rescue Go::Error
        puts "[Go::Engine] #{e.message}"

        return false
      end

      true
    end

    def pass
      prev = @moves.last
      @goban.pass!

      @moves << Move.new(MoveKind::PASS)

      if prev.kind == MoveKind::PASS
        finish
      end
    end

    def resign
      @moves << Move.new(MoveKind::RESIGN)
    end

    def finish
    end

    def is_legal?(point)
      stone = current_turn_stone

      @goban.is_legal?(point, stone)
    end

    def serialize
      Serializer.serialize(self)
    end
  end
end
