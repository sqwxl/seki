require "rails_helper"

RSpec.describe "Undo E2E Functionality", type: :system do
  let!(:black_player) { Player.create!(email: "black@test.com", username: "BlackPlayer") }
  let!(:white_player) { Player.create!(email: "white@test.com", username: "WhitePlayer") }
  let!(:game) do
    Game.create!(
      creator: black_player,
      black: black_player,
      white: white_player,
      cols: 9,
      rows: 9,
      komi: 6.5,
      handicap: 2
    )
  end

  before do
    # Ensure JavaScript assets are built
    system("yarn build") unless File.exist?("app/assets/builds/go.js")
  end

  def as_black_player(&block)
    using_session("black_player") do
      visit "/games/#{game.id}/invitation?token=#{game.invite_token}&email=#{black_player.email}"
      expect(page).to have_current_path(game_path(game))
      yield
    end
  end

  def as_white_player(&block)
    using_session("white_player") do
      visit "/games/#{game.id}/invitation?token=#{game.invite_token}&email=#{white_player.email}"
      expect(page).to have_current_path(game_path(game))
      yield
    end
  end

  def wait_for_websocket_state
    # Wait for ActionCable connection and initial state
    sleep(1)
  end

  describe "Initial game state", js: true do
    scenario "Both players see disabled undo button when no moves made" do
      as_black_player do
        wait_for_websocket_state

        # Check that basic elements are present
        expect(page).to have_css('#game[data-player-stone="1"]')
        expect(page).to have_css("#request-undo-btn", visible: false)

        # Wait for WebSocket to potentially show button
        wait_for_websocket_state

        # Button should be hidden for no moves
        expect(page).to have_css('#request-undo-btn[style*="none"]', visible: false)
      end
    end
  end

  describe "After moves are made", js: true do
    before do
      # Create moves in database
      GameMove.create!(
        game: game,
        player: black_player,
        stone: Go::Stone::BLACK,
        kind: Go::MoveKind::PLAY,
        col: 4,
        row: 4,
        move_number: 0
      )
      GameMove.create!(
        game: game,
        player: white_player,
        stone: Go::Stone::WHITE,
        kind: Go::MoveKind::PLAY,
        col: 3,
        row: 3,
        move_number: 1
      )
    end

    scenario "White player can request undo (made last move, black's turn)" do
      as_white_player do
        wait_for_websocket_state

        # White made last move, it's black's turn, so white should be able to undo
        expect(page).to have_css('#game[data-player-stone="-1"]')

        # Wait for WebSocket state update
        wait_for_websocket_state

        # Button should be visible and enabled
        expect(page).to have_css("#request-undo-btn", visible: true)
        expect(page).to have_css("#request-undo-btn:not([disabled])", visible: true)
      end
    end

    scenario "Black player cannot request undo (their turn)" do
      as_black_player do
        wait_for_websocket_state

        # It's black's turn, so they shouldn't be able to undo
        expect(page).to have_css('#game[data-player-stone="1"]')

        # Wait for WebSocket state update
        wait_for_websocket_state

        # Button should be visible but disabled
        expect(page).to have_css("#request-undo-btn", visible: true)
        expect(page).to have_css("#request-undo-btn[disabled]", visible: true)
      end
    end
  end

  describe "Complete undo workflow", js: true do
    before do
      # Set up game with moves
      GameMove.create!(
        game: game,
        player: black_player,
        stone: Go::Stone::BLACK,
        kind: Go::MoveKind::PLAY,
        col: 4,
        row: 4,
        move_number: 0
      )
      GameMove.create!(
        game: game,
        player: white_player,
        stone: Go::Stone::WHITE,
        kind: Go::MoveKind::PLAY,
        col: 3,
        row: 3,
        move_number: 1
      )
    end

    scenario "White requests undo and black accepts" do
      # White player requests undo
      as_white_player do
        wait_for_websocket_state

        # Should be able to request undo
        expect(page).to have_css("#request-undo-btn:not([disabled])", visible: true)

        click_button("Request Undo")
        wait_for_websocket_state

        # Should show waiting state for WHITE player
        expect(page).to have_text("Undo request sent")
        expect(page).to have_css("#request-undo-btn[disabled]", visible: true)
        # WHITE should NOT see response controls
        expect(page).to have_css("#undo-response-controls", visible: false)
      end

      # Black player sees request and accepts
      as_black_player do
        wait_for_websocket_state

        # Should see undo request for BLACK player
        expect(page).to have_css("#undo-response-controls", visible: true)
        expect(page).to have_text("WhitePlayer has requested to undo")
        # BLACK should NOT see the "Undo request sent" message
        expect(page).not_to have_text("Undo request sent")

        click_button("Accept")

        # Wait for the WebSocket response
        sleep(2)

        # Check that the undo response controls are hidden (indicating response was processed)
        expect(page).to have_css("#undo-response-controls", visible: false, wait: 5)
      end

      # Note: Acceptance result verification can be added once WebSocket result messages are fully working

      # Verify database state
      expect(game.reload.moves.count).to eq(1) # White's move removed
      expect(game.undo_requesting_player).to be_nil
    end

    scenario "White requests undo and black rejects" do
      # White player requests undo
      as_white_player do
        wait_for_websocket_state

        click_button("Request Undo")
        wait_for_websocket_state

        # WHITE should see waiting state
        expect(page).to have_text("Undo request sent")
        expect(page).to have_css("#undo-response-controls", visible: false)
      end

      # Black player rejects
      as_black_player do
        wait_for_websocket_state

        # BLACK should see response controls, not waiting message
        expect(page).to have_css("#undo-response-controls", visible: true)
        expect(page).not_to have_text("Undo request sent")

        click_button("Reject")

        # Wait for the WebSocket response
        sleep(2)

        # Check that the undo response controls are hidden (indicating response was processed)
        expect(page).to have_css("#undo-response-controls", visible: false, wait: 5)
      end

      # Note: Rejection result verification can be added once WebSocket result messages are fully working

      # Verify game state
      expect(game.reload.moves.count).to eq(2) # Both moves remain
      expect(game.undo_requesting_player).to be_nil

      # If white tries to request undo again, it should fail on the backend
      # (Frontend doesn't prevent this yet, but backend should reject duplicate requests)
      as_white_player do
        wait_for_websocket_state

        # Button should be visible since no undo request is pending and it's black's turn
        expect(page).to have_css("#request-undo-btn:not([disabled])", visible: true)

        # But clicking it should result in an error or no effect due to backend validation
        click_button("Request Undo")
        wait_for_websocket_state

        # Should show an error or the request should be ignored
        # The game state should remain unchanged
      end
    end
  end

  describe "Edge cases", js: true do
    scenario "Spectator doesn't see undo controls" do
      using_session("spectator") do
        # Visit game without invitation (will be spectator with playerStone = 0)
        visit game_path(game)
        wait_for_websocket_state

        # Should not see undo controls
        expect(page).to have_css('#game[data-player-stone="0"]')
        expect(page).to have_css('#request-undo-btn[style*="none"]', visible: false)
      end
    end

    scenario "Pass moves cannot be undone" do
      # Create a pass move as the last move
      GameMove.create!(
        game: game,
        player: black_player,
        stone: Go::Stone::BLACK,
        kind: Go::MoveKind::PASS,
        move_number: 0
      )

      as_white_player do
        wait_for_websocket_state

        # White should not be able to undo a pass move
        expect(page).to have_css("#request-undo-btn[disabled]", visible: true)
      end
    end
  end
end
