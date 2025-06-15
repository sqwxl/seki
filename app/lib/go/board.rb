class Board
  attr_reader :sign_map, :rows, :cols

  def initialize(sign_map = [])
    @sign_map = sign_map
    @rows =  sign_map.length
    @cols = @rows.zero?  ? 0 : sign_map.first.length


    # ensure the map is well formed
    if sign_map.any? { |row| row.length != @cols }
      raise "[Board] Malformed state map."
    end

    @captures = { black: 0, white: 0 }
  end

  def get((col, row))
    has?([ col, row ]) ? @sign_map[row][col] : nil
  end

  def set!((col, row), state)
    @sign_map[row][col] = state if has?([ col, row ])
    self
  end

  def has?((col, row))
    col.between?(0, @cols - 1) && row.between?(0, @rows - 1)
  end

  def clear!
    @sign_map.map! { |row| row.map { 0 } }
    self
  end

  def empty?
    @sign_map.all? { |row| row.all?(&:zero?) }
  end

  def neighbors((col, row))
    return [] unless has?([ col, row ])

    [
      [ col - 1, row ],
      [ col + 1, row ],
      [ col, row - 1 ],
      [ col, row + 1 ]
    ].select { |v| has?(v) }
  end

  # Returns an array of connected stones or an empty array if the point is empty
  def chain(point)
    state = get(point)

    bfs(point, ->(p) { get(p) == state })
  end

  def bfs(point, predicate, visited = nil, result = nil)
    return [] unless state == :black || state == :white

    visited ||= Set.new
    result ||= []

    visited.add(point)
    result << point

    neighbors(point).each do |p|
      next unless predicate.call(p)
      next if visited.include?(p)

      bfs(p, predicate, visited, result)
    end

    result
  end

  def liberties((col, row))
  end

  def clone
    new_map = @sign_map.map(&:dup)
    board = self.class_new(new_map)
    # TODO set captures and kos
    board
  end
end
