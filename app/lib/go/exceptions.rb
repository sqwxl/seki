module Go
  class Error < StandardError; end

  class OccupiedPoint < Error; end

  class NotOnBoard < Error; end

  class KoViolation < Error; end

  class Suicide < Error; end
end
