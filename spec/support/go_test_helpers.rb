module GoTestHelpers
  def goban_from_layout(layout)
    rows = layout.map { |row|
      row.chars.map { |c|
        case c
        when "B" then Go::Stone::BLACK
        when "W" then Go::Stone::WHITE
        when "+" then Go::Stone::EMPTY
        end
      }
    }
    Go::Goban.new(rows)
  end

  def engine_from_layout(layout)
    goban = goban_from_layout(layout)
    cols = layout.first.length
    rows = layout.length

    # Create engine with the same dimensions
    engine = Go::Engine.new(cols: cols, rows: rows)

    # Replace the engine's goban with our custom one
    engine.instance_variable_set(:@goban, goban)

    engine
  end
end
