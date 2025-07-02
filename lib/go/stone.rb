module Go
  module Stone
    BLACK = 1
    WHITE = -1
    EMPTY = 0

    def self.name(value)
      case normalize(value)
      when BLACK then "Black"
      when WHITE then "White"
      when EMPTY then "Empty"
      end
    end

    def self.normalize(value)
      case value
      when BLACK, :black then BLACK
      when EMPTY, :empty then EMPTY
      when WHITE, :white then WHITE
      when Integer
        case value <=> 0
        when 1 then BLACK
        when 0 then EMPTY
        when -1 then WHITE
        end
      else
        raise ArgumentError, "Invalid stone: #{value.inspect}"
      end
    end
  end
end
