module Go
  module MoveKind
    PLAY = :play
    PASS = :pass
    RESIGN = :resign
    ALL = [PLAY, PASS, RESIGN]
  end

  class Move < Struct.new(:kind, :point)
    def initialize(kind:, point: nil)
      raise ArgumentError, "invalid move kind" unless MoveKind::ALL.include?(kind)
      super(kind, point)
    end

    def play? = kind == MoveKind::PLAY

    def pass? = kind == MoveKind::PASS

    def resign? = kind == MoveKind::RESIGN
  end
end
