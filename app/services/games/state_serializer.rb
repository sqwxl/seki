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
        negotiations: build_negotiations
      }
    end

    private

    def build_negotiations
      negotiations = {}

      # Add undo request state
      if @game.has_pending_undo_request?
        negotiations[:undo_request] = build_undo_request_state
      end

      # Add territory review state
      if @game.territory_review && !@game.territory_review.settled
        negotiations[:territory_review] = build_territory_review_state
      end

      negotiations
    end

    def build_undo_request_state
      undo_request = @game.undo_request
      {
        id: undo_request.id,
        requesting_player: undo_request.requesting_player.username || "Anonymous",
        target_move_number: undo_request.target_move.move_number,
        status: undo_request.status
      }
    end

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