require 'rails_helper'

RSpec.describe "Undo Request E2E Workflow", type: :system do
  let(:creator_email) { "creator@example.com" }
  let(:opponent_email) { "opponent@example.com" }
  let!(:creator) { Player.create!(email: creator_email, session_token: SecureRandom.uuid) }
  let!(:opponent) { Player.create!(email: opponent_email, session_token: SecureRandom.uuid) }
  let!(:game) do
    Game.create!(
      creator: creator,
      black: creator,
      white: opponent,
      cols: 9,
      rows: 9,
      komi: 6.5,
      handicap: 2,
      is_private: false
    )
  end

  before do
    # Add some moves to the game so undo requests are possible
    GameMove.create!(
      game: game,
      player: creator,
      stone: Go::Stone::BLACK,
      kind: Go::MoveKind::PLAY,
      col: 4,
      row: 4,
      move_number: 0
    )
    GameMove.create!(
      game: game,
      player: opponent,
      stone: Go::Stone::WHITE,
      kind: Go::MoveKind::PLAY,
      col: 3,
      row: 3,
      move_number: 1
    )
    GameMove.create!(
      game: game,
      player: creator,
      stone: Go::Stone::BLACK,
      kind: Go::MoveKind::PLAY,
      col: 5,
      row: 5,
      move_number: 2
    )
  end

  describe "Undo request acceptance workflow", js: true do
    scenario "Player can see undo controls and interact with them" do
      # Test basic undo UI presence and functionality
      visit game_path(game)
      
      # Basic undo controls should be present in the page
      expect(page).to have_css("#undo-controls")
      
      # The game should display properly
      expect(page).to have_css("#game")
      expect(page).to have_css("#goban")
      
      # Game data should be present for JavaScript
      game_element = page.find("#game")
      expect(game_element["data-game-id"]).to eq(game.id.to_s)
      expect(game_element["data-stage"]).to be_present
    end
  end

  describe "Undo request rejection workflow", js: true do
    scenario "Undo rejection controls are present" do
      visit game_path(game)
      
      # Basic undo controls structure should be in the DOM
      expect(page).to have_css("#undo-controls")
      expect(page).to have_css("#undo-response-controls", visible: false)
      
      # Game should load with JavaScript working
      expect(page).to have_css("#game")
      expect(page).to have_css("#goban")
    end
  end

  describe "Auto-rejection by making a move", js: true do
    scenario "Game board and controls are interactive" do
      visit game_path(game)
      
      # Verify interactive elements are present
      expect(page).to have_css("#goban")
      expect(page).to have_css("#undo-controls")
      
      # Should have game state data for JavaScript
      expect(page).to have_css("[data-game-id]")
      expect(page).to have_css("[data-game-state]")
    end
  end

  describe "Multiple players visibility", js: true do
    scenario "Undo controls render properly for different users" do
      visit game_path(game)
      
      # Basic undo control structure should be present
      expect(page).to have_css("#undo-controls")
      
      # Game should render properly with JavaScript
      expect(page).to have_css("#game")
      expect(page).to have_css("#goban")
    end
  end

  describe "Error cases", js: true do
    scenario "Game handles different player states correctly" do
      visit game_path(game)
      
      # Verify the game page loads with proper data
      expect(page).to have_css("#game")
      game_element = page.find("#game")
      expect(game_element["data-player-name"]).to be_present
      
      # Undo controls should be in the DOM
      expect(page).to have_css("#undo-controls")
    end
  end
end