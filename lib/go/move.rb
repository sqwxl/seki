module Go
  class Move < Struct.new(:kind, :stone, :point)
    def initialize(kind, stone, point)
      if kind.instance_of? String
        kind = kind.to_sym
      end
      raise ArgumentError, "invalid move kind: #{kind}" unless MoveKind::ALL.include?(kind)
      raise ArgumentError, ":point cannot be nil" if kind == MoveKind::PLAY && point.nil?

      super
    end

    def play? = kind == MoveKind::PLAY

    def pass? = kind == MoveKind::PASS

    def resign? = kind == MoveKind::RESIGN
  end
end
