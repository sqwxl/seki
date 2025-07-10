require "rails_helper"

RSpec.describe "GamesController#invitation", type: :request do
  let(:creator) { Player.create!(email: "creator@example.com", session_token: SecureRandom.alphanumeric) }
  let(:invited_player) { Player.create!(email: "invited@example.com") }
  let(:game) do
    Game.create!(
      creator: creator,
      black: creator,
      white: nil, # Ensure white is nil for invitation tests
      cols: 9,
      rows: 9,
      komi: 6.5,
      invite_token: SecureRandom.alphanumeric
    )
  end

  describe "GET /games/:id/invitation" do
    context "with valid token and email" do
      it "successfully joins the invited player to the game" do
        expect(invited_player.session_token).to be_nil

        get game_invitation_path(game), params: {
          token: game.invite_token,
          email: invited_player.email
        }

        expect(response).to redirect_to(game_path(game))

        # Verify session was updated
        expect(session[:player_id]).to be_present

        # Verify invited player now has a session token
        invited_player.reload
        expect(invited_player.session_token).to be_present
        expect(session[:player_id]).to eq(invited_player.session_token)

        game.reload
        expect(game.white).to eq(invited_player)
      end

      it "assigns the invited player to an available position" do
        # Create game with no white player assigned yet
        game_with_opening = Game.create!(
          creator: creator,
          black: creator,
          white: nil,
          cols: 9,
          rows: 9,
          komi: 6.5,
          invite_token: SecureRandom.alphanumeric
        )

        get game_invitation_path(game_with_opening), params: {
          token: game_with_opening.invite_token,
          email: invited_player.email
        }

        expect(response).to redirect_to(game_path(game_with_opening))

        game_with_opening.reload
        expect(game_with_opening.white).to eq(invited_player)
      end

      it "assigns to black position if white is taken" do
        other_player = Player.create!(email: "other@example.com")
        game_white_taken = Game.create!(
          creator: creator,
          black: nil,
          white: other_player,
          cols: 9,
          rows: 9,
          komi: 6.5,
          invite_token: SecureRandom.alphanumeric
        )

        get game_invitation_path(game_white_taken), params: {
          token: game_white_taken.invite_token,
          email: invited_player.email
        }

        expect(response).to redirect_to(game_path(game_white_taken))

        game_white_taken.reload
        expect(game_white_taken.black).to eq(invited_player)
      end

      it "doesn't change assignment if player is already in the game" do
        # Player is already assigned as white
        game_with_invited_player = Game.create!(
          creator: creator,
          black: creator,
          white: invited_player,
          cols: 9,
          rows: 9,
          komi: 6.5,
          invite_token: SecureRandom.alphanumeric
        )

        get game_invitation_path(game_with_invited_player), params: {
          token: game_with_invited_player.invite_token,
          email: invited_player.email
        }

        expect(response).to redirect_to(game_path(game_with_invited_player))
        game_with_invited_player.reload
        expect(game_with_invited_player.white).to eq(invited_player)
        expect(game_with_invited_player.black).to eq(creator)
      end
    end

    context "with invalid token" do
      it "renders error for wrong token" do
        get game_invitation_path(game), params: {
          token: "wrong-token",
          email: invited_player.email
        }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.body).to include("The invite link you used is invalid")

        # Session should not be updated to the invited player's token
        expect(session[:player_id]).not_to eq(invited_player.session_token)
      end

      it "renders error for missing token" do
        get game_invitation_path(game), params: {
          email: invited_player.email
        }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.body).to include("The invite link you used is invalid")
      end
    end

    context "with invalid email" do
      it "renders error for wrong email" do
        get game_invitation_path(game), params: {
          token: game.invite_token,
          email: "wrong@example.com"
        }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.body).to include("The invite link you used is invalid")
      end

      it "renders error for missing email" do
        get game_invitation_path(game), params: {
          token: game.invite_token
        }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.body).to include("The invite link you used is invalid")
      end

      it "renders error when player doesn't exist" do
        get game_invitation_path(game), params: {
          token: game.invite_token,
          email: "nonexistent@example.com"
        }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.body).to include("The invite link you used is invalid")
      end
    end

    context "session token handling" do
      it "creates session token for invited player without one" do
        expect(invited_player.session_token).to be_nil

        get game_invitation_path(game), params: {
          token: game.invite_token,
          email: invited_player.email
        }

        invited_player.reload
        expect(invited_player.session_token).to be_present
        expect(invited_player.session_token).to match(/\A[0-9a-f-]{36}\z/) # UUID format
      end

      it "uses existing session token if player already has one" do
        existing_token = SecureRandom.alphanumeric
        invited_player.update!(session_token: existing_token)

        get game_invitation_path(game), params: {
          token: game.invite_token,
          email: invited_player.email
        }

        invited_player.reload
        expect(invited_player.session_token).to eq(existing_token)
        expect(session[:player_id]).to eq(existing_token)
      end
    end
  end
end
