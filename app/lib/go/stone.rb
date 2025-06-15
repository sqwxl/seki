module Go
  module Stone
    BLACK = 1
    WHITE = -1
    EMPTY = 0

    module_function

    def normalize(value)
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
