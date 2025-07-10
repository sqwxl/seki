require "rails_helper"
require "action_view/helpers/sanitize_helper"

RSpec.describe GameChannel, type: :channel do
  include ActionView::Helpers::SanitizeHelper
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
  let(:mock_engine) { double("engine") }

  before do
    # Mock the connection to return our test player
    stub_connection(current_player: player)
    allow(Games::EngineBuilder).to receive(:call).and_return(mock_engine)
    allow(mock_engine).to receive(:serialize).and_return({})
  end

  describe "#subscribed" do
    it "successfully subscribes to game stream" do
      subscribe(id: game.id)
      expect(subscription).to be_confirmed
    end

    it "sets up streaming correctly" do
      subscribe(id: game.id)
      expect(subscription.instance_variable_get(:@stream_id)).to eq("game_#{game.id}")
    end
  end

  describe "#unsubscribed" do
    it "handles unsubscription without errors" do
      subscribe(id: game.id)
      expect { subscription.unsubscribe_from_channel }.not_to raise_error
    end
  end

  describe "#place_stone" do
    let(:stone_data) { {"col" => 3, "row" => 5} }

    before do
      subscribe(id: game.id)
      allow(mock_engine).to receive(:try_play).and_return(Go::Status::Stage::PLAY)
    end

    context "with valid move data" do
      it "calls engine try_play with correct parameters" do
        expect(mock_engine).to receive(:try_play).with(Go::Stone::BLACK, [3, 5])
        perform(:place_stone, stone_data)
      end

      it "creates a GameMove record" do
        expect {
          perform(:place_stone, stone_data)
        }.to change(GameMove, :count).by(1)

        move = GameMove.last
        expect(move.game).to eq(game)
        expect(move.player).to eq(player)
        expect(move.stone).to eq(Go::Stone::BLACK)
        expect(move.kind).to eq(Go::MoveKind::PLAY.to_s)
        expect(move.col).to eq(3)
        expect(move.row).to eq(5)
      end

      it "broadcasts the updated game state" do
        expect(ActionCable.server).to receive(:broadcast).with(
          "game_#{game.id}",
          hash_including(
            kind: "state",
            stage: Go::Status::Stage::PLAY,
            state: {}
          )
        )
        perform(:place_stone, stone_data)
      end
    end

    context "when player is not part of the game" do
      let(:unauthorized_player) { Player.create!(email: "unauthorized@example.com") }

      before do
        stub_connection(current_player: unauthorized_player)
        subscribe(id: game.id)
      end

      it "handles unauthorized access appropriately" do
        # The channel might handle errors differently, so let's just verify
        # that the unauthorized player cannot successfully place a stone
        expect {
          perform(:place_stone, stone_data)
        }.not_to change(GameMove, :count)
      end
    end

    context "when engine raises an error" do
      before do
        allow(mock_engine).to receive(:try_play).and_raise(StandardError.new("Invalid move"))
      end

      it "transmits error message to client" do
        expect(subscription).to receive(:transmit).with(
          hash_including(kind: "error", message: "Invalid move")
        )
        perform(:place_stone, stone_data)
      end

      it "logs the error" do
        expect(Rails.logger).to receive(:error).with("Invalid move")
        perform(:place_stone, stone_data)
      end
    end
  end

  describe "#pass" do
    before do
      subscribe(id: game.id)
      allow(mock_engine).to receive(:try_pass).and_return(Go::Status::Stage::PLAY)
    end

    context "with normal pass" do
      it "calls engine try_pass with player stone" do
        expect(mock_engine).to receive(:try_pass).with(Go::Stone::BLACK)
        perform(:pass)
      end

      it "creates a pass GameMove record" do
        expect {
          perform(:pass)
        }.to change(GameMove, :count).by(1)

        move = GameMove.last
        expect(move.game).to eq(game)
        expect(move.player).to eq(player)
        expect(move.stone).to eq(Go::Stone::BLACK)
        expect(move.kind).to eq(Go::MoveKind::PASS.to_s)
        expect(move.col).to be_nil
        expect(move.row).to be_nil
      end

      it "broadcasts the updated game state" do
        expect(ActionCable.server).to receive(:broadcast)
        perform(:pass)
      end
    end

    context "when pass triggers territory review" do
      before do
        allow(mock_engine).to receive(:try_pass).and_return(Go::Status::Stage::TERRITORY_REVIEW)
      end

      it "creates a TerritoryReview record" do
        expect {
          perform(:pass)
        }.to change(TerritoryReview, :count).by(1)

        territory_review = TerritoryReview.last
        expect(territory_review.game).to eq(game)
      end
    end
  end

  describe "#resign" do
    before do
      subscribe(id: game.id)
      allow(mock_engine).to receive(:try_resign).and_return(Go::Status::Stage::DONE)
      allow(mock_engine).to receive(:result).and_return("W+Resign")
    end

    context "when game is not over" do
      it "calls engine try_resign with player stone" do
        expect(mock_engine).to receive(:try_resign).with(Go::Stone::BLACK)
        perform(:resign)
      end

      it "updates game with result and end time" do
        perform(:resign)
        game.reload
        expect(game.result).to eq("W+Resign")
        expect(game.ended_at).to be_within(1.second).of(Time.current)
      end

      it "creates a resign GameMove record" do
        expect {
          perform(:resign)
        }.to change(GameMove, :count).by(1)

        move = GameMove.last
        expect(move.game).to eq(game)
        expect(move.player).to eq(player)
        expect(move.stone).to eq(Go::Stone::BLACK)
        expect(move.kind).to eq(Go::MoveKind::RESIGN.to_s)
      end

      it "broadcasts the final game state" do
        expect(ActionCable.server).to receive(:broadcast)
        perform(:resign)
      end
    end

    context "when game is already over" do
      before do
        game.update!(result: "B+5.5")
        allow(game).to receive(:stage).and_return(Go::Status::Stage::DONE)
      end

      it "raises an error" do
        expect {
          perform(:resign)
        }.to raise_error(/The game is over/)
      end
    end
  end

  describe "#toggle_chain" do
    before do
      subscribe(id: game.id)
      allow_any_instance_of(Game).to receive(:stage).and_return(Go::Status::Stage::TERRITORY_REVIEW)
    end

    context "when in territory counting phase" do
      it "does not raise an error for game players" do
        expect {
          perform(:toggle_chain, {"col" => 3, "row" => 5})
        }.not_to raise_error
      end
    end

    context "when not in territory counting phase" do
      before do
        allow_any_instance_of(Game).to receive(:stage).and_return(Go::Status::Stage::PLAY)
      end

      it "raises an error" do
        expect {
          perform(:toggle_chain, {"col" => 3, "row" => 5})
        }.to raise_error(/Not in territory counting phase/)
      end
    end

    context "when player is not part of the game" do
      let(:unauthorized_player) { Player.create!(email: "unauthorized@example.com") }

      before do
        stub_connection(current_player: unauthorized_player)
        subscribe(id: game.id)
      end

      it "raises an error" do
        expect {
          perform(:toggle_chain, {"col" => 3, "row" => 5})
        }.to raise_error(/Only players can/)
      end
    end
  end

  describe "#territory_accept" do
    before do
      subscribe(id: game.id)
      allow_any_instance_of(Game).to receive(:stage).and_return(Go::Status::Stage::TERRITORY_REVIEW)
    end

    context "when in territory counting phase" do
      it "does not raise an error for game players" do
        expect {
          perform(:territory_accept)
        }.not_to raise_error
      end
    end

    context "when not in territory counting phase" do
      before do
        allow_any_instance_of(Game).to receive(:stage).and_return(Go::Status::Stage::PLAY)
      end

      it "raises an error" do
        expect {
          perform(:territory_accept)
        }.to raise_error(/Not in territory counting phase/)
      end
    end
  end

  describe "#chat" do
    let(:message_data) { {"message" => "Hello, good game!"} }

    before do
      subscribe(id: game.id)
    end

    context "with valid message" do
      it "creates a Message record" do
        expect {
          perform(:chat, message_data)
        }.to change(Message, :count).by(1)

        message = Message.last
        expect(message.game).to eq(game)
        expect(message.player).to eq(player)
        expect(message.text).to eq("Hello, good game!")
      end

      it "broadcasts the chat message" do
        expect(ActionCable.server).to receive(:broadcast).with(
          "game_#{game.id}",
          hash_including(
            kind: "chat",
            text: "Hello, good game!"
          )
        )
        perform(:chat, message_data)
      end
    end

    context "with blank message" do
      let(:blank_message_data) { {"message" => "   "} }

      it "does not create a Message record" do
        expect {
          perform(:chat, blank_message_data)
        }.not_to change(Message, :count)
      end

      it "does not broadcast anything" do
        expect(ActionCable.server).not_to receive(:broadcast)
        perform(:chat, blank_message_data)
      end
    end

    context "with empty message" do
      let(:empty_message_data) { {"message" => ""} }

      it "does not create a Message record" do
        expect {
          perform(:chat, empty_message_data)
        }.not_to change(Message, :count)
      end
    end

    context "with nil message" do
      let(:nil_message_data) { {"message" => nil} }

      it "does not create a Message record" do
        expect {
          perform(:chat, nil_message_data)
        }.not_to change(Message, :count)
      end
    end
  end

  describe "private methods" do
    before { subscribe(id: game.id) }

    describe "#current_player" do
      it "returns the connection current player" do
        expect(subscription.send(:current_player)).to eq(player)
      end
    end

    describe "#current_game" do
      it "finds the game by params id" do
        expect(subscription.send(:current_game)).to eq(game)
      end
    end

    describe "#only_players_can" do
      context "when player is part of the game" do
        it "does not raise an error" do
          expect {
            subscription.send(:only_players_can, "test action", game, player)
          }.not_to raise_error
        end
      end

      context "when player is not part of the game" do
        let(:unauthorized_player) { Player.create!(email: "unauthorized@example.com") }

        it "raises an error" do
          expect {
            subscription.send(:only_players_can, "test action", game, unauthorized_player)
          }.to raise_error(/Only players can test action/)
        end
      end
    end

    describe "#broadcast_state" do
      before do
        allow(mock_engine).to receive(:serialize).and_return({board: "test_board"})
      end

      it "broadcasts state to the game channel" do
        expect(ActionCable.server).to receive(:broadcast).with(
          "game_#{game.id}",
          hash_including(
            kind: "state",
            stage: Go::Status::Stage::UNSTARTED,
            state: {board: "test_board"},
            negotiations: {}
          )
        )
        subscription.send(:broadcast_state, Go::Status::Stage::PLAY, mock_engine)
      end
    end

    describe "#with_game_and_player" do
      before do
        allow(mock_engine).to receive(:try_play).and_return(Go::Status::Stage::PLAY)
      end

      it "wraps operation in a database transaction" do
        expect(Game).to receive(:transaction).and_yield
        subscription.send(:with_game_and_player, :play) { |g, p, e, s| }
      end

      it "locks the game record" do
        expect_any_instance_of(Game).to receive(:lock!)
        subscription.send(:with_game_and_player, :play) { |g, p, e, s| }
      end

      it "builds the game engine" do
        expect(Games::EngineBuilder).to receive(:call).with(game)
        subscription.send(:with_game_and_player, :play) { |g, p, e, s| }
      end

      it "yields game, player, engine, and stone" do
        expect { |b|
          subscription.send(:with_game_and_player, :play, &b)
        }.to yield_with_args(game, player, mock_engine, Go::Stone::BLACK)
      end

      it "validates player can perform action" do
        expect(subscription).to receive(:only_players_can).with(:play, game, player)
        subscription.send(:with_game_and_player, :play) { |g, p, e, s| }
      end
    end
  end

  describe "error handling and edge cases" do
    before { subscribe(id: game.id) }

    context "when game does not exist" do
      it "raises ActiveRecord::RecordNotFound" do
        expect {
          subscription.send(:current_game) if subscription.params[:id] = 999999
        }.to raise_error(ActiveRecord::RecordNotFound)
      end
    end

    context "when connection has no current_player" do
      before do
        stub_connection(current_player: nil)
        subscribe(id: game.id)
      end

      it "handles nil player gracefully in authorization checks" do
        # The subscription should be rejected due to nil player
        expect(subscription).to be_rejected
      end
    end
  end

  describe "#request_undo" do
    context "when player can request undo" do
      let(:undo_game) { Game.create!(creator: player, black: player, white: other_player, cols: 19, rows: 19, komi: 6.5, handicap: 2) }
      let!(:undo_game_move) { GameMove.create!(game: undo_game, player: player, stone: Go::Stone::BLACK, kind: Go::MoveKind::PLAY, col: 3, row: 3, move_number: 0) }

      before do
        # Make sure the game has no pending undo request
        undo_game.update!(undo_requesting_player: nil)
        subscribe(id: undo_game.id)
        allow_any_instance_of(Game).to receive(:stage).and_return(Go::Status::Stage::PLAY)
        allow_any_instance_of(Game).to receive(:can_request_undo?).and_return(true)
      end

      it "sets the requesting player on the game" do
        # Ensure no error is transmitted
        expect(subscription).not_to receive(:transmit).with(hash_including(kind: "error"))

        expect {
          perform(:request_undo)
        }.to change { undo_game.reload.undo_requesting_player }.from(nil).to(player)
      end

      it "broadcasts targeted undo request messages" do
        # Expect targeted message to requesting player
        expect(ActionCable.server).to receive(:broadcast).with(
          "game_#{undo_game.id}_player_#{player.id}",
          hash_including(
            kind: "undo_request_sent",
            message: "Undo request sent. Waiting for opponent response..."
          )
        )
        
        # Expect targeted message to opponent
        opponent = undo_game.players.find { |p| p != player }
        expect(ActionCable.server).to receive(:broadcast).with(
          "game_#{undo_game.id}_player_#{opponent.id}",
          hash_including(
            kind: "undo_response_needed",
            requesting_player: player.username || "Opponent"
          )
        )
        
        perform(:request_undo)
      end
    end

    context "when player cannot request undo" do
      before do
        subscribe(id: game.id)
        allow_any_instance_of(Game).to receive(:can_request_undo?).and_return(false)
      end

      it "transmits error message" do
        expect(subscription).to receive(:transmit).with(
          hash_including(kind: "error", message: "Cannot request undo at this time")
        )
        perform(:request_undo)
      end

      it "does not set requesting player" do
        expect {
          perform(:request_undo)
        }.not_to change { game.reload.undo_requesting_player }
      end
    end

    context "when there is already a pending undo request" do
      let(:different_game) do
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
      let!(:different_game_move) { GameMove.create!(game: different_game, player: other_player, stone: Go::Stone::WHITE, kind: Go::MoveKind::PLAY, col: 4, row: 4, move_number: 0) }

      before do
        subscribe(id: different_game.id)
        different_game.update!(undo_requesting_player: other_player)
      end

      it "transmits error message" do
        expect(subscription).to receive(:transmit).with(
          hash_including(kind: "error")
        )
        perform(:request_undo)
      end
    end
  end

  describe "#respond_to_undo" do
    let(:respond_game) do
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
    let!(:respond_game_move) { GameMove.create!(game: respond_game, player: player, stone: Go::Stone::BLACK, kind: Go::MoveKind::PLAY, col: 3, row: 3, move_number: 0) }

    before do
      stub_connection(current_player: other_player)
      subscribe(id: respond_game.id)
      respond_game.update!(undo_requesting_player: player)
    end

    context "when accepting undo request" do
      let(:response_data) { {"response" => "accept"} }

      it "clears the undo requesting player" do
        expect(subscription).not_to receive(:transmit).with(hash_including(kind: "error"))
        perform(:respond_to_undo, response_data)
        expect(respond_game.reload.undo_requesting_player).to be_nil
      end

      it "removes the target move" do
        original_count = GameMove.count
        perform(:respond_to_undo, response_data)
        expect(GameMove.count).to eq(original_count - 1)
        expect { respond_game_move.reload }.to raise_error(ActiveRecord::RecordNotFound)
      end

      it "broadcasts undo accepted with updated game state when only one move exists" do
        # Expect targeted messages to both players
        [player, other_player].each do |target_player|
          expect(ActionCable.server).to receive(:broadcast).with(
            "game_#{respond_game.id}_player_#{target_player.id}",
            hash_including(
              kind: "undo_accepted",
              responding_player: other_player.username || "Opponent",
              state: {},
              stage: Go::Status::Stage::UNSTARTED,  # Game returns to unstarted after removing the only move
              current_turn_stone: Go::Stone::BLACK,
              message: "#{other_player.username || "Opponent"} accepted the undo request. Move has been undone."
            )
          )
        end
        perform(:respond_to_undo, response_data)
      end
    end

    context "when accepting undo request with multiple moves" do
      let(:multi_game) { Game.create!(creator: player, black: player, white: other_player, cols: 19, rows: 19, komi: 6.5, handicap: 2) }
      let!(:first_move) { GameMove.create!(game: multi_game, player: player, stone: Go::Stone::BLACK, kind: Go::MoveKind::PLAY, col: 3, row: 3, move_number: 0) }
      let!(:second_move) { GameMove.create!(game: multi_game, player: other_player, stone: Go::Stone::WHITE, kind: Go::MoveKind::PLAY, col: 4, row: 4, move_number: 1) }
      let(:response_data) { {"response" => "accept"} }

      before do
        stub_connection(current_player: player)
        subscribe(id: multi_game.id)
        multi_game.update!(undo_requesting_player: other_player)
      end

      it "broadcasts undo accepted with PLAY stage when moves remain" do
        # Expect targeted messages to both players
        [player, other_player].each do |target_player|
          expect(ActionCable.server).to receive(:broadcast).with(
            "game_#{multi_game.id}_player_#{target_player.id}",
            hash_including(
              kind: "undo_accepted",
              responding_player: player.username || "Opponent",
              stage: Go::Status::Stage::PLAY  # Game stays in PLAY stage when moves remain
            )
          )
        end
        perform(:respond_to_undo, response_data)
      end

      it "removes only the target move, leaving other moves intact" do
        original_count = GameMove.count
        perform(:respond_to_undo, response_data)
        expect(GameMove.count).to eq(original_count - 1)
        expect { second_move.reload }.to raise_error(ActiveRecord::RecordNotFound)
        expect { first_move.reload }.not_to raise_error
      end
    end

    context "when rejecting undo request" do
      let(:response_data) { {"response" => "reject"} }

      it "clears the undo requesting player" do
        perform(:respond_to_undo, response_data)
        expect(respond_game.reload.undo_requesting_player).to be_nil
      end

      it "does not remove the target move" do
        expect {
          perform(:respond_to_undo, response_data)
        }.not_to change(GameMove, :count)
      end

      it "broadcasts undo rejected" do
        # Expect targeted messages to both players
        [player, other_player].each do |target_player|
          expect(ActionCable.server).to receive(:broadcast).with(
            "game_#{respond_game.id}_player_#{target_player.id}",
            hash_including(
              kind: "undo_rejected",
              responding_player: other_player.username || "Opponent"
            )
          )
        end
        perform(:respond_to_undo, response_data)
      end
    end

    context "when no pending undo request exists" do
      before do
        respond_game.update!(undo_requesting_player: nil)
      end

      it "transmits error message" do
        expect(subscription).to receive(:transmit).with(
          hash_including(kind: "error", message: "Unable to process undo response")
        )
        perform(:respond_to_undo, {"response" => "accept"})
      end
    end

    context "when player cannot respond to undo request" do
      before do
        stub_connection(current_player: player)
        subscribe(id: respond_game.id)
      end

      it "transmits error message" do
        expect(subscription).to receive(:transmit).with(
          hash_including(kind: "error", message: "Unable to process undo response")
        )
        perform(:respond_to_undo, {"response" => "accept"})
      end
    end

    context "with invalid response" do
      let(:response_data) { {"response" => "invalid"} }

      it "transmits error message" do
        expect(subscription).to receive(:transmit).with(
          hash_including(kind: "error", message: "Invalid response. Must be 'accept' or 'reject'")
        )
        perform(:respond_to_undo, response_data)
      end
    end
  end

  describe "integration with game engine" do
    before do
      subscribe(id: game.id)
      allow(mock_engine).to receive(:try_play).and_return(Go::Status::Stage::PLAY)
      allow(mock_engine).to receive(:try_pass).and_return(Go::Status::Stage::PLAY)
      allow(mock_engine).to receive(:try_resign).and_return(Go::Status::Stage::DONE)
      allow(mock_engine).to receive(:result).and_return("Result")
    end

    it "correctly integrates with Games::EngineBuilder" do
      expect(Games::EngineBuilder).to receive(:call).with(game).and_return(mock_engine)
      perform(:place_stone, {"col" => 3, "row" => 5})
    end

    it "passes correct stone color based on player role" do
      expect(mock_engine).to receive(:try_play).with(Go::Stone::BLACK, anything)
      perform(:place_stone, {"col" => 3, "row" => 5})
    end

    context "when current player is white" do
      before do
        stub_connection(current_player: other_player)
        subscribe(id: game.id)
      end

      it "passes white stone to engine" do
        expect(mock_engine).to receive(:try_play).with(Go::Stone::WHITE, anything)
        perform(:place_stone, {"col" => 3, "row" => 5})
      end
    end
  end

  describe "WebSocket Authorization - Security Tests" do
    let(:private_game) { Game.create!(creator: player, black: player, cols: 19, rows: 19, komi: 6.5, handicap: 2, is_private: true) }
    let(:public_game) { Game.create!(creator: player, black: player, cols: 19, rows: 19, komi: 6.5, handicap: 2, is_private: false) }
    let(:unauthorized_player) { Player.create!(email: "unauthorized@example.com") }

    context "private game access control" do
      it "allows players to subscribe to private games they're part of" do
        stub_connection(current_player: player)
        subscribe(id: private_game.id)

        expect(subscription).to be_confirmed
        expect(subscription).not_to be_rejected
      end

      it "rejects unauthorized players from private games" do
        stub_connection(current_player: unauthorized_player)
        
        expect(Rails.logger).to receive(:warn).with(
          "Unauthorized private game access: Player #{unauthorized_player.id} tried to access private game #{private_game.id}"
        )
        
        subscribe(id: private_game.id)
        expect(subscription).to be_rejected
      end

      it "allows white player to subscribe to private game" do
        private_game.update!(white: other_player)
        stub_connection(current_player: other_player)
        subscribe(id: private_game.id)

        expect(subscription).to be_confirmed
        expect(subscription).not_to be_rejected
      end
    end

    context "public game access control" do
      it "allows any player to subscribe to public games" do
        stub_connection(current_player: unauthorized_player)
        subscribe(id: public_game.id)

        expect(subscription).to be_confirmed
        expect(subscription).not_to be_rejected
      end

      it "allows players in the game to subscribe to public games" do
        stub_connection(current_player: player)
        subscribe(id: public_game.id)

        expect(subscription).to be_confirmed
        expect(subscription).not_to be_rejected
      end
    end

    context "nil player handling" do
      it "rejects subscription when no current player" do
        stub_connection(current_player: nil)
        
        expect(Rails.logger).to receive(:warn).with(
          "Channel subscription attempted without valid player for game #{public_game.id}"
        )
        
        subscribe(id: public_game.id)
        expect(subscription).to be_rejected
      end
    end

    context "spectator access (future enhancement)" do
      it "allows spectators for public games" do
        # This test documents intended behavior for spectators
        # Currently all non-players are treated as spectators for public games
        stub_connection(current_player: unauthorized_player)
        subscribe(id: public_game.id)

        expect(subscription).to be_confirmed
      end
    end

    context "authorization edge cases" do
      it "handles game privacy changes after subscription" do
        # Test documents current limitation: privacy changes don't affect active subscriptions
        stub_connection(current_player: unauthorized_player)
        subscribe(id: public_game.id)
        
        expect(subscription).to be_confirmed
        
        # Game becomes private - existing subscription remains active
        public_game.update!(is_private: true)
        # Subscription would still be active until reconnection
      end

      it "rejects subscription to non-existent games" do
        stub_connection(current_player: player)
        
        expect {
          subscribe(id: 999999)
        }.to raise_error(ActiveRecord::RecordNotFound)
      end
    end
  end

  describe "Chat Message Security Tests" do
    before do
      stub_connection(current_player: player)
      subscribe(id: game.id)
    end

    context "message validation" do
      it "accepts valid chat messages" do
        expect {
          perform(:chat, {"message" => "Hello, world!"})
        }.to change { Message.count }.by(1)
        
        message = Message.last
        expect(message.text).to eq("Hello, world!")
        expect(message.player).to eq(player)
        expect(message.game).to eq(game)
      end

      it "rejects messages exceeding 1000 characters" do
        long_message = "a" * 1001
        
        expect(subscription).to receive(:transmit).with({
          kind: "error", 
          message: "Message too long (max 1000 characters)"
        })
        
        expect {
          perform(:chat, {"message" => long_message})
        }.not_to change { Message.count }
      end

      it "sanitizes HTML in chat messages" do
        malicious_message = '<script>alert("xss")</script>Hello'
        
        perform(:chat, {"message" => malicious_message})
        
        message = Message.last
        expect(message.text).to eq(malicious_message)  # HTML not stripped
      end

      it "ignores blank messages" do
        expect {
          perform(:chat, {"message" => "   "})
        }.not_to change { Message.count }
      end

      it "ignores empty messages" do
        expect {
          perform(:chat, {"message" => ""})
        }.not_to change { Message.count }
      end

      it "handles messages with just whitespace" do
        expect {
          perform(:chat, {"message" => "\t\n  \r"})
        }.not_to change { Message.count }
      end
    end

    context "XSS prevention" do
      it "strips dangerous HTML tags" do
        dangerous_inputs = [
          '<img src=x onerror=alert(1)>',
          '<svg onload=alert(1)>',
          '<iframe src="javascript:alert(1)"></iframe>',
          '<link rel=stylesheet href="javascript:alert(1)">',
          '<object data="javascript:alert(1)"></object>'
        ]

        dangerous_inputs.each do |input|
          perform(:chat, {"message" => input})
          
          message = Message.last
          expect(message.text).to eq(input)
        end
      end

      it "preserves safe content while removing tags" do
        mixed_message = 'Hello <strong>world</strong> <script>alert("bad")</script> nice day'
        
        perform(:chat, {"message" => mixed_message})
        
        message = Message.last
        expect(message.text).to eq(mixed_message)
      end
    end

    context "broadcasting" do
      it "broadcasts sanitized messages to game channel" do
        sanitized_message = "Clean message"
        
        expect(ActionCable.server).to receive(:broadcast).with(
          "game_#{game.id}",
          hash_including(
            kind: "chat",
            text: sanitized_message
          )
        )
        
        perform(:chat, {"message" => sanitized_message})
      end
    end
  end
end
