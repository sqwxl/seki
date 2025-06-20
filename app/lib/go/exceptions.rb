module Go
  class Error < StandardError; end

  class Overwrite < Error; end

  class NotOnBoard < Error; end

  class KoViolation < Error; end

  class Suicide < Error; end
end
