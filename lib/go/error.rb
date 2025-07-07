module Go
  class Error < StandardError
    class OutOfTurn < Error; end

    class Overwrite < Error; end

    class Suicide < Error; end

    class NotOnBoard < Error; end

    class KoViolation < Error; end
  end
end
