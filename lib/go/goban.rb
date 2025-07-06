module Go
  KoStatus = Struct.new("KoStatus", :point, :stone)
  NO_KO = KoStatus.new([-1, -1], Stone::EMPTY).freeze

  class Goban
    attr_reader :mtrx, :ko, :captures

    def initialize(mtrx = [])
      @mtrx = mtrx
      @rows = mtrx.length
      @cols = @rows.zero? ? 0 : mtrx.first.length

      # ensure the matrix is well formed
      if mtrx.any? { |row| row.length != @cols }
        raise ArgumentError, "Malformed board matrix: #{mtrx.inspect}"
      end

      @captures = {Stone::BLACK => 0, Stone::WHITE => 0}
      @ko = NO_KO
    end

    def initialize_copy(original)
      super
      @mtrx = original.instance_variable_get(:@mtrx).map(&:dup)
      @captures = original.instance_variable_get(:@captures).dup
      ko = original.instance_variable_get(:@ko).dup
      @ko = KoStatus.new(ko.point.dup, ko.stone)
    end

    def inspect
      b = ""
      @mtrx.each_with_index do |row, j|
        l = ""
        row.each_with_index do |stone, i|
          l << case stone
          when Stone::BLACK then "B"
          when Stone::WHITE then "W"
          when Stone::EMPTY then (@ko.point == [i, j]) ? "#" : "+"
          end
        end
        b << l + "\n"
      end

      [b, "Black captures: #{@captures[Stone::BLACK]}", "White captures: #{@captures[Stone::WHITE]}"].join("\n")
    end

    def is_legal?(point, stone)
      begin
        place_stone(point, stone)
      rescue
        return false
      end

      true
    end

    def play(point, stone)
      return self if stone == Stone::EMPTY

      goban, dead_stones, liberties = place_stone(point, stone)

      # detect future ko
      is_ko = dead_stones.length == 1 &&
        liberties.length == 1 &&
        liberties.first == dead_stones.first &&
        goban.neighbors(point).none? { |n| stone_at(n) == stone }

      goban.instance_variable_set(:@ko, is_ko ? KoStatus.new(dead_stones.first, -stone) : NO_KO)

      goban
    end

    def pass!
      @ko = NO_KO
    end

    def stone_at((col, row))
      on_board?([col, row]) ? @mtrx[row][col] : nil
    end

    def on_board?((col, row))
      !col.nil? && !row.nil? && col.between?(0, @cols - 1) && row.between?(0, @rows - 1)
    end

    def empty?
      @mtrx.all? { |row| row.all?(&:zero?) }
    end

    def restore_state!(board:, captures:, ko:)
      @mtrx = board
      @captures = captures
      @ko = if ko && ko[:point] && ko[:point] != [-1, -1]
        KoStatus.new(ko[:point], ko[:stone])
      else
        NO_KO
      end
    end

    protected

    def set_stone!((col, row), stone)
      @mtrx[row][col] = stone if on_board?([col, row])
    end

    def add_captures!(stone, count)
      unless [Stone::BLACK, Stone::WHITE].include?(stone)
        raise ArgumentError, "Got unexpected stone: #{stone.inspect}"
      end
      @captures[stone] += count
    end

    def ko?(point, stone)
      @ko[:point] == point && @ko[:stone] == stone
    end

    def place_stone(point, stone)
      raise Error::NotOnBoard unless on_board?(point)

      raise Error::Overwrite unless stone_at(point)&.zero?

      goban = dup
      goban.set_stone!(point, stone)

      raise Error::KoViolation if goban.ko?(point, stone)

      # captures
      dead_stones = []
      goban.neighbor_chains(point)
        .each { |c| dead_stones.concat(c) if goban.get_chain_liberties(c).empty? }

      goban.capture(dead_stones)

      liberties = goban.get_liberties(point)

      raise Error::Suicide if liberties.empty?

      [goban, dead_stones, liberties]
    end

    def capture(stones)
      return if stones.empty?

      if stones.any? { |s| stone_at(s)&.zero? }
        raise ArgumentError, "Expected dead stones, got an empty point."
      end

      stone = stone_at(stones.first)

      if !stones.all? { |s| stone_at(s) == stone }
        raise ArgumentError, "Expected all dead stones to share color"
      end

      stones.each { |s| set_stone!(s, Stone::EMPTY) }

      add_captures!(-stone, stones.length)
    end

    def neighbors((col, row))
      return [] unless on_board?([col, row])

      [
        [col - 1, row],
        [col + 1, row],
        [col, row - 1],
        [col, row + 1]
      ].select { |v| on_board?(v) }
    end

    def get_liberties(point)
      return [] unless stone_at(point)&.nonzero?

      get_chain_liberties(chain(point))
    end

    def get_chain_liberties(chain)
      chain.each_with_object(Set.new) do |p, acc|
        neighbors(p).each { |n| acc << n if stone_at(n)&.zero? }
      end.to_a

      # Rails.logger.debug "Chain liberties: #{s.inspect}"
    end

    def neighbor_chains(point)
      return [] unless stone_at(point)&.nonzero?

      stone = stone_at(point)
      chains = []
      visited = Set.new

      neighbors(point)
        .each do |n|
          next if stone_at(n) != -stone
          next if visited.include?(n)

          ch = chain(n, visited)

          chains << ch unless ch.empty?
        end

      # puts "Neighbor chains: #{chains.inspect}"

      chains
    end

    def chain(point, visited = nil, result = nil)
      return [] unless stone_at(point)&.nonzero?

      stone = stone_at(point)

      visited ||= Set.new
      result ||= []

      visited.add(point)
      result << point

      neighbors(point).each do |p|
        next unless stone_at(p) == stone
        next if visited.include?(p)

        chain(p, visited, result)
      end

      result
    end

    class << self
      def with_dimensions(cols:, rows: nil, moves: [])
        rows ||= cols
        mtrx = Array.new(rows) { Array.new(cols, Stone::EMPTY) }

        goban = new(mtrx)

        moves.each_with_index do |move, i|
          # point may be absent for passed turn
          next unless move.play?
          goban = goban.play(move.point, (i % 2 == 0) ? Stone::BLACK : Stone::WHITE)
        end

        goban
      end
    end
  end
end
