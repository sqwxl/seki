require "json"

module Go
  module Result
    UNDECIDED = :undecided
    DRAW = :draw
    WIN = :win
  end

  module Stage
    UNSTARTED = :unstarted
    PLAY = :play
    TERRITORY_REVIEW = :territory_review
    DONE = :done
  end
end
