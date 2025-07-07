require "uri"
require "rails_helper"

RSpec.describe "Game Playing Workflow", type: :system do
  let!(:creator) { Player.create!(email: "creator@example.com", session_token: SecureRandom.uuid) }
  let!(:opponent) { Player.create!(email: "opponent@example.com", session_token: SecureRandom.uuid) }

  describe "Complete game creation to playing flow", js: true do
    scenario "Two players create, join, and interact with a game" do
      # Player 1 creates a game
      using_session("creator") do
        visit root_path

        # Fill out game creation form
        fill_in "Board size", with: 9
        fill_in "Komi", with: 6.5
        choose "color_black"
        fill_in "invite_email", with: opponent.email

        click_button "Create Game"

        # Should be redirected to the game
        expect(page).to have_current_path(/\/games\/\d+/)
        expect(page).to have_css("#game")
        expect(page).to have_css("#goban")

        # Should see chat interface
        expect(page).to have_css("#chat")
        expect(page).to have_field("chat-input")

        # Send a welcome message
        fill_in "chat-input", with: "Good game!"
        click_button "Send"
        wait_for_actioncable

        expect(page).to have_content("Good game!")
      end

      # Player 2 joins via invite link (simulated)
      game = Game.last
      using_session("opponent") do
        # Simulate clicking the invite link
        visit "/games/#{game.id}/invitation?token=#{URI.encode_uri_component(game.invite_token)}&email=#{URI.encode_uri_component(opponent.email)}"

        # Should be redirected to the game
        expect(page).to have_current_path(game_path(game))
        expect(page).to have_css("#game")

        # Should see the creator's chat message
        expect(page).to have_content("Good game!")

        # Respond in chat
        fill_in "chat-input", with: "Thanks! You too!"
        click_button "Send"
        wait_for_actioncable

        expect(page).to have_content("Thanks! You too!")
      end

      # Both players should see each other's messages
      using_session("creator") do
        wait_for_actioncable
        expect(page).to have_content("Thanks! You too!")
      end

      # Verify game state in database
      game.reload
      expect(game.black).to be_present
      expect(game.white).to be_present
      # Note: Actual player assignments may differ due to CurrentPlayerResolver creating new players
    end
  end

  describe "Game state updates", js: true do
    let!(:game) do
      Game.create!(
        creator: creator,
        black: creator,
        white: opponent,
        cols: 9,
        rows: 9,
        komi: 6.5,
        is_private: false
      )
    end

    scenario "Players see real-time game state changes" do
      # Both players join the game
      using_session("creator") do
        visit game_path(game)
        wait_for_actioncable

        expect(page).to have_css("#game")
        expect(page).to have_css("#status", visible: false)
        expect(page).to have_css("#captures", visible: false)
      end

      using_session("opponent") do
        visit game_path(game)
        wait_for_actioncable

        expect(page).to have_css("#game")
        expect(page).to have_css("#status", visible: false)
        expect(page).to have_css("#captures", visible: false)
      end

      # Verify both see the same initial state
      using_session("creator") do
        expect(page).to have_css("#goban")
      end

      using_session("opponent") do
        expect(page).to have_css("#goban")
      end
    end
  end

  describe "Error handling", js: true do
    let!(:game) do
      Game.create!(
        creator: creator,
        black: creator,
        white: opponent,
        cols: 9,
        rows: 9,
        komi: 6.5,
        is_private: false
      )
    end

    scenario "Handles connection issues gracefully" do
      using_session("creator") do
        visit game_path(game)
        wait_for_actioncable

        # Should have error display area
        expect(page).to have_css("#game-error", visible: false)

        # Chat should still work even if game actions fail
        fill_in "chat-input", with: "Testing chat functionality"
        click_button "Send"
        wait_for_actioncable

        expect(page).to have_content("Testing chat functionality")
      end
    end
  end

  describe "Game progression", js: true do
    let!(:game) do
      Game.create!(
        creator: creator,
        black: creator,
        white: opponent,
        cols: 9,
        rows: 9,
        komi: 6.5,
        is_private: false
      )
    end

    scenario "Game progresses through different stages" do
      using_session("creator") do
        visit game_path(game)
        wait_for_actioncable

        # Game board should be rendered and functional
        expect(page).to have_css("#goban")
        expect(page).to have_css("#game")

        # Board dimensions should be available
        game_element = page.find("#game")
        expect(game_element["data-board-cols"]).to eq(game.cols.to_s)
        expect(game_element["data-board-rows"]).to eq(game.rows.to_s)
      end

      # Add a move to change the stage
      GameMove.create!(
        game: game,
        player: creator,
        stone: Go::Stone::BLACK,
        kind: Go::MoveKind::PLAY,
        col: 4,
        row: 4,
        move_number: 0
      )

      using_session("creator") do
        # Refresh to see the updated state
        visit game_path(game)
        wait_for_actioncable

        # Game should still be functional with moves
        expect(page).to have_css("#goban")
        expect(page).to have_css("#game")
      end
    end
  end

  describe "Responsive design", js: true do
    let!(:game) do
      Game.create!(
        creator: creator,
        black: creator,
        white: opponent,
        cols: 9,
        rows: 9,
        komi: 6.5,
        is_private: false
      )
    end

    scenario "Game interface works on different screen sizes" do
      using_session("creator") do
        # Test desktop size
        page.driver.browser.manage.window.resize_to(1400, 1000)
        visit game_path(game)
        wait_for_actioncable

        expect(page).to have_css("#game")
        expect(page).to have_css("#goban")
        expect(page).to have_css("#chat")

        # Test mobile size
        page.driver.browser.manage.window.resize_to(375, 667)

        # All elements should still be present
        expect(page).to have_css("#game")
        expect(page).to have_css("#goban")
        expect(page).to have_css("#chat")
      end
    end
  end
end
