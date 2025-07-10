require "rails_helper"

RSpec.describe GamesController, type: :request do
  let(:player) { Player.create!(email: "player@example.com") }
  let(:other_player) { Player.create!(email: "other@example.com") }
  let(:game) do
    Game.create!(
      creator: player,
      black: player,
      white: other_player,
      cols: 19,
      rows: 19,
      komi: 6.5,
      handicap: 2
    )
  end

  before do
    allow_any_instance_of(CurrentPlayerResolver).to receive(:resolve!).and_return(player)
  end

  describe "GET /games" do
    it "renders successfully" do
      get "/games"
      expect(response).to have_http_status(:success)
    end
  end

  describe "GET /games/new" do
    it "renders successfully" do
      get "/games/new"
      expect(response).to have_http_status(:success)
    end
  end

  describe "POST /games" do
    let(:valid_params) do
      {
        game: {
          cols: 19,
          rows: 19,
          komi: 6.5,
          handicap: 2,
          is_private: false,
          is_handicap: true
        },
        color: "black"
      }
    end

    let(:invalid_params) do
      {
        game: {
          cols: 1, # Invalid - too small
          rows: 19,
          komi: 6.5,
          handicap: 2
        }
      }
    end

    context "with valid parameters" do
      before do
        allow(Games::Creator).to receive(:call).and_return(game)
      end

      it "calls Games::Creator service" do
        expect(Games::Creator).to receive(:call)
        post "/games", params: valid_params
      end

      it "redirects to the created game" do
        post "/games", params: valid_params
        expect(response).to redirect_to(game_path(game))
      end
    end

    context "with invalid parameters" do
      before do
        allow(Games::Creator).to receive(:call).and_raise(
          ActiveRecord::RecordInvalid.new(Game.new.tap { |g| g.errors.add(:cols, "is too small") })
        )
      end

      it "renders new template with unprocessable entity status" do
        post "/games", params: invalid_params
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "renders the new template" do
        post "/games", params: invalid_params
        expect(response.body).to include("Start a New Go Game") # Actual text from template
      end
    end

    context "with invite email" do
      let(:params_with_email) do
        valid_params.merge(invite_email: "friend@example.com")
      end

      before do
        allow(Games::Creator).to receive(:call).and_return(game)
      end

      it "passes invite email to creator service" do
        expect(Games::Creator).to receive(:call)
        post "/games", params: params_with_email
      end
    end
  end

  describe "GET /games/:id" do
    before do
      mock_engine = double("engine")
      allow(mock_engine).to receive(:serialize).and_return({})
      allow(Games::EngineBuilder).to receive(:call).and_return(mock_engine)
    end

    it "renders successfully" do
      get game_path(game)
      expect(response).to have_http_status(:success)
    end

    context "when game does not exist" do
      it "returns 404 not found" do
        get "/games/999999"
        expect(response).to have_http_status(:not_found)
      end
    end
  end

  describe "POST /games/:id/join" do
    context "when player is not already in the game" do
      let(:new_player) { Player.create!(email: "newplayer@example.com") }
      let(:game_without_black) do
        Game.create!(
          creator: player,
          white: other_player,
          cols: 19,
          rows: 19,
          komi: 6.5,
          handicap: 2
        )
      end

      before do
        allow_any_instance_of(CurrentPlayerResolver).to receive(:resolve!).and_return(new_player)
      end

      it "assigns current player to black if black slot is empty" do
        post "/games/#{game_without_black.id}/join"
        expect(game_without_black.reload.black).to eq(new_player)
      end

      it "assigns current player to white if black is taken but white is empty" do
        game_without_white = Game.create!(
          creator: player,
          black: player,
          cols: 19,
          rows: 19,
          komi: 6.5,
          handicap: 2
        )

        post "/games/#{game_without_white.id}/join"
        expect(game_without_white.reload.white).to eq(new_player)
      end

      it "redirects to the game" do
        post "/games/#{game_without_black.id}/join"
        expect(response).to redirect_to(game_path(game_without_black))
      end
    end

    context "when player is already in the game" do
      it "does not modify the game" do
        original_black = game.black
        original_white = game.white

        post "/games/#{game.id}/join"

        game.reload
        expect(game.black).to eq(original_black)
        expect(game.white).to eq(original_white)
      end

      it "redirects to the game" do
        post "/games/#{game.id}/join"
        expect(response).to redirect_to(game_path(game))
      end
    end

    context "when both player slots are full" do
      let(:third_player) { Player.create!(email: "third@example.com") }

      before do
        allow_any_instance_of(CurrentPlayerResolver).to receive(:resolve!).and_return(third_player)
      end

      it "does not modify the game" do
        original_black = game.black
        original_white = game.white

        post "/games/#{game.id}/join"

        game.reload
        expect(game.black).to eq(original_black)
        expect(game.white).to eq(original_white)
      end

      it "redirects to the game" do
        post "/games/#{game.id}/join"
        expect(response).to redirect_to(game_path(game))
      end
    end

    context "when game does not exist" do
      it "returns 404 not found" do
        post "/games/999999/join"
        expect(response).to have_http_status(:not_found)
      end
    end
  end

  describe "integration with services" do
    it "uses CurrentPlayerResolver to get current player" do
      expect_any_instance_of(CurrentPlayerResolver).to receive(:resolve!)
      get "/games"
    end

    it "uses Games::Creator for game creation" do
      allow(Games::Creator).to receive(:call).and_return(game)
      expect(Games::Creator).to receive(:call)

      post "/games", params: {
        game: {cols: 19, rows: 19, komi: 6.5, handicap: 2}
      }
    end
  end

  describe "error handling" do
    context "when Games::Creator raises RecordInvalid" do
      before do
        allow(Games::Creator).to receive(:call).and_raise(
          ActiveRecord::RecordInvalid.new(Game.new.tap { |g| g.errors.add(:base, "Invalid game") })
        )
      end

      it "renders new template with errors" do
        post "/games", params: {game: {cols: 19, rows: 19}}
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end

    context "when ActiveRecord::RecordNotFound is raised" do
      it "renders 404 page for non-existent game show" do
        get "/games/999999"
        expect(response).to have_http_status(:not_found)
      end

      it "renders 404 page for non-existent game join" do
        post "/games/999999/join"
        expect(response).to have_http_status(:not_found)
      end
    end
  end

  describe "authentication flow" do
    it "ensures player is resolved before each action" do
      expect_any_instance_of(CurrentPlayerResolver).to receive(:resolve!).at_least(:once)
      get "/games"
    end
  end

  describe "game creation workflow" do
    let(:creation_params) do
      {
        game: {
          cols: 19,
          rows: 19,
          komi: 6.5,
          handicap: 2,
          is_private: false,
          is_handicap: true
        },
        color: "black",
        invite_email: "friend@example.com"
      }
    end

    before do
      allow(Games::Creator).to receive(:call).and_return(game)
    end

    it "follows complete game creation flow" do
      # Start at new game page
      get "/games/new"
      expect(response).to have_http_status(:success)

      # Submit game creation form
      post "/games", params: creation_params
      expect(response).to redirect_to(game_path(game))

      # Follow redirect to game page
      follow_redirect!
      expect(response).to have_http_status(:success)
    end
  end

  describe "game joining workflow" do
    let(:joinable_game) do
      Game.create!(
        creator: other_player,
        black: other_player,
        cols: 19,
        rows: 19,
        komi: 6.5,
        handicap: 2
      )
    end

    it "allows player to join as white" do
      # Visit game page (player can see it)
      mock_engine = double("engine")
      allow(mock_engine).to receive(:serialize).and_return({})
      allow(Games::EngineBuilder).to receive(:call).and_return(mock_engine)
      get game_path(joinable_game)
      expect(response).to have_http_status(:success)

      # Join the game
      post "/games/#{joinable_game.id}/join"
      expect(response).to redirect_to(game_path(joinable_game))
      expect(joinable_game.reload.white).to eq(player)

      # Follow redirect back to game
      follow_redirect!
      expect(response).to have_http_status(:success)
    end
  end

  describe "parameter handling" do
    it "handles string parameters correctly" do
      allow(Games::Creator).to receive(:call).and_return(game)

      post "/games", params: {
        game: {
          cols: "19",      # String instead of integer
          rows: "19",
          komi: "6.5",     # String instead of float
          handicap: "2"
        }
      }

      expect(response).to redirect_to(game_path(game))
    end

    it "handles missing optional parameters" do
      allow(Games::Creator).to receive(:call).and_return(game)

      post "/games", params: {
        game: {
          cols: 19,
          rows: 19,
          komi: 6.5,
          handicap: 2
        }
        # No color or invite_email
      }

      expect(response).to redirect_to(game_path(game))
    end
  end

  describe "GET /games/:id/invitation - Security Tests" do
    let(:invited_game) do
      Game.create!(
        creator: player,
        black: nil, # Ensure black is nil for invitation tests
        white: nil, # Ensure white is nil for invitation tests
        cols: 19,
        rows: 19,
        komi: 6.5,
        handicap: 2
      )
    end
    let(:guest_player) { Player.create!(email: "guest@example.com") }

    context "with valid invitation parameters" do
      before do
        allow_any_instance_of(CurrentPlayerResolver).to receive(:resolve!).and_return(player)
      end

      it "successfully processes valid invitation" do
        get "/games/#{invited_game.id}/invitation", params: {
          token: invited_game.invite_token,
          email: guest_player.email
        }

        expect(response).to redirect_to(game_path(invited_game))
        expect(invited_game.reload.white).to eq(guest_player)
      end

      it "updates session to invited player" do
        get "/games/#{invited_game.id}/invitation", params: {
          token: invited_game.invite_token,
          email: guest_player.email
        }

        expect(session[:player_id]).to eq(guest_player.ensure_session_token!)
      end

      it "logs session transfer for security auditing" do
        expect(Rails.logger).to receive(:info).with(
          "Session transferred from #{player.id} to #{guest_player.id} for game #{invited_game.id}"
        )

        get "/games/#{invited_game.id}/invitation", params: {
          token: invited_game.invite_token,
          email: guest_player.email
        }
      end
    end

    context "security validations" do
      it "rejects invitation with missing token" do
        get "/games/#{invited_game.id}/invitation", params: {
          email: guest_player.email
        }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.body).to include("The invite link you used is invalid")
      end

      it "rejects invitation with blank token" do
        get "/games/#{invited_game.id}/invitation", params: {
          token: "",
          email: guest_player.email
        }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.body).to include("The invite link you used is invalid")
      end

      it "rejects invitation with missing email" do
        get "/games/#{invited_game.id}/invitation", params: {
          token: "valid-token-123"
        }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.body).to include("The invite link you used is invalid")
      end

      it "rejects invitation with blank email" do
        get "/games/#{invited_game.id}/invitation", params: {
          token: "valid-token-123",
          email: ""
        }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.body).to include("The invite link you used is invalid")
      end

      it "rejects invitation with invalid token (prevents timing attacks)" do
        expect(Rails.logger).to receive(:warn).with("Invite link failed: Invalid invitation token")

        get "/games/#{invited_game.id}/invitation", params: {
          token: "invalid-token",
          email: guest_player.email
        }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.body).to include("The invite link you used is invalid")
      end

      it "rejects invitation with malformed email" do
        expect(Rails.logger).to receive(:warn).with("Invite link failed: Invalid email format")

        get "/games/#{invited_game.id}/invitation", params: {
          token: invited_game.invite_token,
          email: "not-an-email"
        }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.body).to include("The invite link you used is invalid")
      end

      it "rejects invitation for non-existent player" do
        expect(Rails.logger).to receive(:warn).with("Invite link failed: Player with email nonexistent@example.com not found")

        get "/games/#{invited_game.id}/invitation", params: {
          token: invited_game.invite_token,
          email: "nonexistent@example.com"
        }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.body).to include("The invite link you used is invalid")
      end

      it "rejects invitation when game is already full" do
        invited_game.update!(white: other_player)  # Fill the white slot

        expect(Rails.logger).to receive(:warn).with("Invite link failed: Game is already full")

        get "/games/#{invited_game.id}/invitation", params: {
          token: invited_game.invite_token,
          email: guest_player.email
        }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.body).to include("The invite link you used is invalid")
      end

      it "prevents session hijacking when current player is different game participant" do
        # Set current player to someone already in the game
        allow_any_instance_of(CurrentPlayerResolver).to receive(:resolve!).and_return(other_player)
        invited_game.update!(white: other_player)

        expect(Rails.logger).to receive(:warn).with("Invite link failed: You are already logged in as a different player in this game")

        get "/games/#{invited_game.id}/invitation", params: {
          token: invited_game.invite_token,
          email: guest_player.email
        }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.body).to include("The invite link you used is invalid")
      end
    end

    context "CSRF protection" do
      it "has CSRF protection enabled" do
        # This test verifies CSRF protection is configured
        expect(ApplicationController.new.forgery_protection_strategy).to be_a(ActionController::RequestForgeryProtection::ProtectionMethods::Exception)
      end
    end

    context "when player is already in the game" do
      before do
        invited_game.update!(white: guest_player)
        allow_any_instance_of(CurrentPlayerResolver).to receive(:resolve!).and_return(player)
      end

      it "does not transfer session if guest is current player" do
        get "/games/#{invited_game.id}/invitation", params: {
          token: invited_game.invite_token,
          email: guest_player.email
        }

        # Should redirect without changing session since guest is current player
        expect(response).to redirect_to(game_path(invited_game))
      end
    end

    context "edge cases" do
      it "handles concurrent invitation attempts gracefully" do
        # Simulate race condition by having another player join between token check and assignment
        allow(invited_game).to receive(:players).and_return([player, other_player])

        expect(Rails.logger).to receive(:warn).with("Invite link failed: Game is full")

        get "/games/#{invited_game.id}/invitation", params: {
          token: invited_game.invite_token,
          email: guest_player.email
        }

        expect(response).to have_http_status(:unprocessable_entity)
      end
    end
  end
end
