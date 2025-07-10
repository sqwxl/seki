module Games
  class StateSerializer
    def self.call(game, engine)
      new(game, engine).call
    end

    def initialize(game, engine)
      @game = game
      @engine = engine
    end

    def call
      {
        stage: @game.stage,
        state: @engine.serialize,
        negotiations: build_negotiations,
        current_turn_stone: @game.current_turn_stone
      }
    end

    private

    def build_negotiations
      negotiations = {}

      # Add territory review state
      if @game.territory_review && !@game.territory_review.settled
        negotiations[:territory_review] = build_territory_review_state
      end

      # Add undo request state
      if @game.has_pending_undo_request?
        negotiations[:undo_request] = build_undo_request_state
      end

      negotiations
    end

    def build_undo_request_state
      requesting_player = @game.undo_requesting_player
      {
        requesting_player: requesting_player.username || "Anonymous"
      }
    end

    # Remove build_undo_request_state - no longer needed with targeted messaging

    def build_territory_review_state
      territory_review = @game.territory_review
      {
        id: territory_review.id,
        settled: territory_review.settled
        # Add other territory review fields as needed
      }
    end
  end
end
