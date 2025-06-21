module Go
  module MoveKind
    PLAY = :play
    PASS = :pass
    RESIGN = :resign
    ALL = [PLAY, PASS, RESIGN]
  end

  class Move < Struct.new(:kind, :stone, :point)
    def initialize(kind, stone, point = nil)
      if kind.instance_of? String
        kind = kind.to_sym
      end
      raise ArgumentError, "invalid move kind: #{kind}" unless MoveKind::ALL.include?(kind)
      super
    end

    def play? = kind == MoveKind::PLAY

    def pass? = kind == MoveKind::PASS

    def resign? = kind == MoveKind::RESIGN
  end
end
