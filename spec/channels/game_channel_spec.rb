require 'rails_helper'

RSpec.describe GameChannel, type: :channel do
  let(:player) { Player.create!(email: 'player@example.com') }
  let(:other_player) { Player.create!(email: 'other@example.com') }
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
  let(:mock_engine) { double('engine') }

  before do
    # Mock the connection to return our test player
    stub_connection(current_player: player)
    allow(Games::EngineBuilder).to receive(:call).and_return(mock_engine)
    allow(mock_engine).to receive(:serialize).and_return({})
  end

  describe '#subscribed' do
    it 'successfully subscribes to game stream' do
      subscribe(id: game.id)
      expect(subscription).to be_confirmed
    end

    it 'sets up streaming correctly' do
      subscribe(id: game.id)
      expect(subscription.instance_variable_get(:@stream_id)).to eq("game_#{game.id}")
    end
  end

  describe '#unsubscribed' do
    it 'handles unsubscription without errors' do
      subscribe(id: game.id)
      expect { subscription.unsubscribe_from_channel }.not_to raise_error
    end
  end

  describe '#place_stone' do
    let(:stone_data) { { 'col' => 3, 'row' => 5 } }

    before do
      subscribe(id: game.id)
      allow(mock_engine).to receive(:try_play).and_return(Go::Status::Stage::PLAY)
    end

    context 'with valid move data' do
      it 'calls engine try_play with correct parameters' do
        expect(mock_engine).to receive(:try_play).with(Go::Stone::BLACK, [ 3, 5 ])
        perform(:place_stone, stone_data)
      end

      it 'creates a GameMove record' do
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

      it 'broadcasts the updated game state' do
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

    context 'when player is not part of the game' do
      let(:unauthorized_player) { Player.create!(email: 'unauthorized@example.com') }

      before do
        stub_connection(current_player: unauthorized_player)
        subscribe(id: game.id)
      end

      it 'handles unauthorized access appropriately' do
        # The channel might handle errors differently, so let's just verify
        # that the unauthorized player cannot successfully place a stone
        expect {
          perform(:place_stone, stone_data)
        }.not_to change(GameMove, :count)
      end
    end

    context 'when engine raises an error' do
      before do
        allow(mock_engine).to receive(:try_play).and_raise(StandardError.new("Invalid move"))
      end

      it 'transmits error message to client' do
        expect(subscription).to receive(:transmit).with(
          hash_including(kind: "error", message: "Invalid move")
        )
        perform(:place_stone, stone_data)
      end

      it 'logs the error' do
        expect(Rails.logger).to receive(:error).with("Invalid move")
        perform(:place_stone, stone_data)
      end
    end
  end

  describe '#pass' do
    before do
      subscribe(id: game.id)
      allow(mock_engine).to receive(:try_pass).and_return(Go::Status::Stage::PLAY)
    end

    context 'with normal pass' do
      it 'calls engine try_pass with player stone' do
        expect(mock_engine).to receive(:try_pass).with(Go::Stone::BLACK)
        perform(:pass)
      end

      it 'creates a pass GameMove record' do
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

      it 'broadcasts the updated game state' do
        expect(ActionCable.server).to receive(:broadcast)
        perform(:pass)
      end
    end

    context 'when pass triggers territory review' do
      before do
        allow(mock_engine).to receive(:try_pass).and_return(Go::Status::Stage::TERRITORY_REVIEW)
      end

      it 'creates a TerritoryReview record' do
        expect {
          perform(:pass)
        }.to change(TerritoryReview, :count).by(1)

        territory_review = TerritoryReview.last
        expect(territory_review.game).to eq(game)
      end
    end
  end

  describe '#resign' do
    before do
      subscribe(id: game.id)
      allow(mock_engine).to receive(:try_resign).and_return(Go::Status::Stage::DONE)
      allow(mock_engine).to receive(:result).and_return("W+Resign")
    end

    context 'when game is not over' do
      it 'calls engine try_resign with player stone' do
        expect(mock_engine).to receive(:try_resign).with(Go::Stone::BLACK)
        perform(:resign)
      end

      it 'updates game with result and end time' do
        perform(:resign)
        game.reload
        expect(game.result).to eq("W+Resign")
        expect(game.ended_at).to be_within(1.second).of(Time.current)
      end

      it 'creates a resign GameMove record' do
        expect {
          perform(:resign)
        }.to change(GameMove, :count).by(1)

        move = GameMove.last
        expect(move.game).to eq(game)
        expect(move.player).to eq(player)
        expect(move.stone).to eq(Go::Stone::BLACK)
        expect(move.kind).to eq(Go::MoveKind::RESIGN.to_s)
      end

      it 'broadcasts the final game state' do
        expect(ActionCable.server).to receive(:broadcast)
        perform(:resign)
      end
    end

    context 'when game is already over' do
      before do
        game.update!(result: "B+5.5")
        allow(game).to receive(:stage).and_return(Go::Status::Stage::DONE)
      end

      it 'raises an error' do
        expect {
          perform(:resign)
        }.to raise_error(/The game is over/)
      end
    end
  end

  describe '#toggle_chain' do
    before do
      subscribe(id: game.id)
      allow_any_instance_of(Game).to receive(:stage).and_return(Go::Status::Stage::TERRITORY_REVIEW)
    end

    context 'when in territory counting phase' do
      it 'does not raise an error for game players' do
        expect {
          perform(:toggle_chain, { 'col' => 3, 'row' => 5 })
        }.not_to raise_error
      end
    end

    context 'when not in territory counting phase' do
      before do
        allow_any_instance_of(Game).to receive(:stage).and_return(Go::Status::Stage::PLAY)
      end

      it 'raises an error' do
        expect {
          perform(:toggle_chain, { 'col' => 3, 'row' => 5 })
        }.to raise_error(/Not in territory counting phase/)
      end
    end

    context 'when player is not part of the game' do
      let(:unauthorized_player) { Player.create!(email: 'unauthorized@example.com') }

      before do
        stub_connection(current_player: unauthorized_player)
        subscribe(id: game.id)
      end

      it 'raises an error' do
        expect {
          perform(:toggle_chain, { 'col' => 3, 'row' => 5 })
        }.to raise_error(/Only players can/)
      end
    end
  end

  describe '#territory_accept' do
    before do
      subscribe(id: game.id)
      allow_any_instance_of(Game).to receive(:stage).and_return(Go::Status::Stage::TERRITORY_REVIEW)
    end

    context 'when in territory counting phase' do
      it 'does not raise an error for game players' do
        expect {
          perform(:territory_accept)
        }.not_to raise_error
      end
    end

    context 'when not in territory counting phase' do
      before do
        allow_any_instance_of(Game).to receive(:stage).and_return(Go::Status::Stage::PLAY)
      end

      it 'raises an error' do
        expect {
          perform(:territory_accept)
        }.to raise_error(/Not in territory counting phase/)
      end
    end
  end

  describe '#chat' do
    let(:message_data) { { 'message' => 'Hello, good game!' } }

    before do
      subscribe(id: game.id)
    end

    context 'with valid message' do
      it 'creates a Message record' do
        expect {
          perform(:chat, message_data)
        }.to change(Message, :count).by(1)

        message = Message.last
        expect(message.game).to eq(game)
        expect(message.player).to eq(player)
        expect(message.text).to eq('Hello, good game!')
      end

      it 'broadcasts the chat message' do
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

    context 'with blank message' do
      let(:blank_message_data) { { 'message' => '   ' } }

      it 'does not create a Message record' do
        expect {
          perform(:chat, blank_message_data)
        }.not_to change(Message, :count)
      end

      it 'does not broadcast anything' do
        expect(ActionCable.server).not_to receive(:broadcast)
        perform(:chat, blank_message_data)
      end
    end

    context 'with empty message' do
      let(:empty_message_data) { { 'message' => '' } }

      it 'does not create a Message record' do
        expect {
          perform(:chat, empty_message_data)
        }.not_to change(Message, :count)
      end
    end

    context 'with nil message' do
      let(:nil_message_data) { { 'message' => nil } }

      it 'does not create a Message record' do
        expect {
          perform(:chat, nil_message_data)
        }.not_to change(Message, :count)
      end
    end
  end

  describe 'private methods' do
    before { subscribe(id: game.id) }

    describe '#current_player' do
      it 'returns the connection current player' do
        expect(subscription.send(:current_player)).to eq(player)
      end
    end

    describe '#current_game' do
      it 'finds the game by params id' do
        expect(subscription.send(:current_game)).to eq(game)
      end
    end

    describe '#only_players_can' do
      context 'when player is part of the game' do
        it 'does not raise an error' do
          expect {
            subscription.send(:only_players_can, "test action", game, player)
          }.not_to raise_error
        end
      end

      context 'when player is not part of the game' do
        let(:unauthorized_player) { Player.create!(email: 'unauthorized@example.com') }

        it 'raises an error' do
          expect {
            subscription.send(:only_players_can, "test action", game, unauthorized_player)
          }.to raise_error(/Only players can test action/)
        end
      end
    end

    describe '#broadcast_state' do
      before do
        allow(mock_engine).to receive(:serialize).and_return({ board: "test_board" })
      end

      it 'broadcasts state to the game channel' do
        expect(ActionCable.server).to receive(:broadcast).with(
          "game_#{game.id}",
          hash_including(
            kind: "state",
            stage: Go::Status::Stage::UNSTARTED,
            state: { board: "test_board" },
            negotiations: {}
          )
        )
        subscription.send(:broadcast_state, Go::Status::Stage::PLAY, mock_engine)
      end
    end

    describe '#with_game_and_player' do
      before do
        allow(mock_engine).to receive(:try_play).and_return(Go::Status::Stage::PLAY)
      end

      it 'wraps operation in a database transaction' do
        expect(Game).to receive(:transaction).and_yield
        subscription.send(:with_game_and_player, :play) { |g, p, e, s| }
      end

      it 'locks the game record' do
        expect_any_instance_of(Game).to receive(:lock!)
        subscription.send(:with_game_and_player, :play) { |g, p, e, s| }
      end

      it 'builds the game engine' do
        expect(Games::EngineBuilder).to receive(:call).with(game)
        subscription.send(:with_game_and_player, :play) { |g, p, e, s| }
      end

      it 'yields game, player, engine, and stone' do
        expect { |b|
          subscription.send(:with_game_and_player, :play, &b)
        }.to yield_with_args(game, player, mock_engine, Go::Stone::BLACK)
      end

      it 'validates player can perform action' do
        expect(subscription).to receive(:only_players_can).with(:play, game, player)
        subscription.send(:with_game_and_player, :play) { |g, p, e, s| }
      end
    end
  end

  describe 'error handling and edge cases' do
    before { subscribe(id: game.id) }

    context 'when game does not exist' do
      it 'raises ActiveRecord::RecordNotFound' do
        expect {
          subscription.send(:current_game) if subscription.params[:id] = 999999
        }.to raise_error(ActiveRecord::RecordNotFound)
      end
    end

    context 'when connection has no current_player' do
      before do
        stub_connection(current_player: nil)
        subscribe(id: game.id)
      end

      it 'handles nil player gracefully in authorization checks' do
        expect {
          subscription.send(:only_players_can, "test", game, nil)
        }.to raise_error(/Only players can/)
      end
    end
  end

  describe '#request_undo' do
    context 'when player can request undo' do
      let(:undo_game) { Game.create!(creator: player, black: player, white: other_player, cols: 19, rows: 19, komi: 6.5, handicap: 2) }
      let!(:undo_game_move) { GameMove.create!(game: undo_game, player: player, stone: Go::Stone::BLACK, kind: Go::MoveKind::PLAY, col: 3, row: 3, move_number: 0) }

      before do
        # Clean up any existing undo requests
        UndoRequest.destroy_all
        # Make sure the game has no undo_request
        undo_game.undo_request&.destroy
        undo_game.reload
        subscribe(id: undo_game.id)
        allow_any_instance_of(Game).to receive(:stage).and_return(Go::Status::Stage::PLAY)
        allow_any_instance_of(Game).to receive(:can_request_undo?).and_return(true)
      end

      it 'creates an undo request' do
        # Ensure no error is transmitted
        expect(subscription).not_to receive(:transmit).with(hash_including(kind: "error"))

        expect {
          perform(:request_undo)
        }.to change(UndoRequest, :count).by(1)

        undo_request = UndoRequest.last
        expect(undo_request.game).to eq(undo_game)
        expect(undo_request.requesting_player).to eq(player)
        expect(undo_request.target_move).to eq(undo_game_move)
        expect(undo_request.status).to eq(UndoRequestStatus::PENDING)
      end

      it 'broadcasts undo request to game channel' do
        expect(ActionCable.server).to receive(:broadcast).with(
          "game_#{undo_game.id}",
          hash_including(
            kind: "undo_request",
            requesting_player: player.username || "Anonymous",
            move_number: undo_game_move.move_number
          )
        )
        perform(:request_undo)
      end
    end

    context 'when player cannot request undo' do
      before do
        subscribe(id: game.id)
        allow_any_instance_of(Game).to receive(:can_request_undo?).and_return(false)
      end

      it 'transmits error message' do
        expect(subscription).to receive(:transmit).with(
          hash_including(kind: "error", message: "Cannot request undo at this time")
        )
        perform(:request_undo)
      end

      it 'does not create undo request' do
        expect {
          perform(:request_undo)
        }.not_to change(UndoRequest, :count)
      end
    end

    context 'when there is already a pending undo request' do
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
        UndoRequest.create!(
          game: different_game,
          requesting_player: other_player,
          target_move: different_game_move,
          status: UndoRequestStatus::PENDING
        )
      end

      it 'transmits error message' do
        expect(subscription).to receive(:transmit).with(
          hash_including(kind: "error")
        )
        perform(:request_undo)
      end
    end
  end

  describe '#respond_to_undo' do
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
    let!(:undo_request) do
      UndoRequest.create!(
        game: respond_game,
        requesting_player: player,
        target_move: respond_game_move,
        status: UndoRequestStatus::PENDING
      )
    end

    before do
      stub_connection(current_player: other_player)
      subscribe(id: respond_game.id)
    end

    context 'when accepting undo request' do
      let(:response_data) { { 'response' => 'accept' } }

      it 'accepts the undo request and deletes it with the target move' do
        expect(subscription).not_to receive(:transmit).with(hash_including(kind: "error"))
        original_undo_count = UndoRequest.count
        perform(:respond_to_undo, response_data)
        # Undo request is deleted by cascade when target move is deleted
        expect(UndoRequest.count).to eq(original_undo_count - 1)
        expect { undo_request.reload }.to raise_error(ActiveRecord::RecordNotFound)
      end

      it 'removes the target move' do
        original_count = GameMove.count
        perform(:respond_to_undo, response_data)
        expect(GameMove.count).to eq(original_count - 1)
        expect { respond_game_move.reload }.to raise_error(ActiveRecord::RecordNotFound)
      end

      it 'broadcasts undo accepted with updated game state when only one move exists' do
        expect(ActionCable.server).to receive(:broadcast).with(
          "game_#{respond_game.id}",
          hash_including(
            kind: "undo_accepted",
            request_id: undo_request.id,
            responding_player: other_player.username || "Anonymous",
            state: {},
            stage: Go::Status::Stage::UNSTARTED  # Game returns to unstarted after removing the only move
          )
        )
        perform(:respond_to_undo, response_data)
      end
    end

    context 'when accepting undo request with multiple moves' do
      let(:multi_game) { Game.create!(creator: player, black: player, white: other_player, cols: 19, rows: 19, komi: 6.5, handicap: 2) }
      let!(:first_move) { GameMove.create!(game: multi_game, player: player, stone: Go::Stone::BLACK, kind: Go::MoveKind::PLAY, col: 3, row: 3, move_number: 0) }
      let!(:second_move) { GameMove.create!(game: multi_game, player: other_player, stone: Go::Stone::WHITE, kind: Go::MoveKind::PLAY, col: 4, row: 4, move_number: 1) }
      let!(:undo_request_multi) do
        UndoRequest.create!(
          game: multi_game,
          requesting_player: other_player,
          target_move: second_move,
          status: UndoRequestStatus::PENDING
        )
      end
      let(:response_data) { { 'response' => 'accept' } }

      before do
        stub_connection(current_player: player)
        subscribe(id: multi_game.id)
      end

      it 'broadcasts undo accepted with PLAY stage when moves remain' do
        expect(ActionCable.server).to receive(:broadcast).with(
          "game_#{multi_game.id}",
          hash_including(
            kind: "undo_accepted",
            request_id: undo_request_multi.id,
            responding_player: player.username || "Anonymous",
            state: {},
            stage: Go::Status::Stage::PLAY  # Game stays in PLAY stage when moves remain
          )
        )
        perform(:respond_to_undo, response_data)
      end

      it 'removes only the target move, leaving other moves intact' do
        original_count = GameMove.count
        perform(:respond_to_undo, response_data)
        expect(GameMove.count).to eq(original_count - 1)
        expect { second_move.reload }.to raise_error(ActiveRecord::RecordNotFound)
        expect { first_move.reload }.not_to raise_error
      end
    end

    context 'when rejecting undo request' do
      let(:response_data) { { 'response' => 'reject' } }

      it 'rejects the undo request' do
        perform(:respond_to_undo, response_data)
        undo_request.reload
        expect(undo_request.status).to eq(UndoRequestStatus::REJECTED)
        expect(undo_request.responded_by).to eq(other_player)
      end

      it 'does not remove the target move' do
        expect {
          perform(:respond_to_undo, response_data)
        }.not_to change(GameMove, :count)
      end

      it 'broadcasts undo rejected' do
        expect(ActionCable.server).to receive(:broadcast).with(
          "game_#{respond_game.id}",
          hash_including(
            kind: "undo_rejected",
            request_id: undo_request.id,
            responding_player: other_player.username || "Anonymous"
          )
        )
        perform(:respond_to_undo, response_data)
      end
    end

    context 'when no pending undo request exists' do
      before do
        undo_request.update!(status: UndoRequestStatus::ACCEPTED)
      end

      it 'transmits error message' do
        expect(subscription).to receive(:transmit).with(
          hash_including(kind: "error", message: "No pending undo request found")
        )
        perform(:respond_to_undo, { 'response' => 'accept' })
      end
    end

    context 'when player cannot respond to undo request' do
      before do
        stub_connection(current_player: player)
        subscribe(id: respond_game.id)
      end

      it 'transmits error message' do
        expect(subscription).to receive(:transmit).with(
          hash_including(kind: "error", message: "You cannot respond to this undo request")
        )
        perform(:respond_to_undo, { 'response' => 'accept' })
      end
    end

    context 'with invalid response' do
      let(:response_data) { { 'response' => 'invalid' } }

      it 'transmits error message' do
        expect(subscription).to receive(:transmit).with(
          hash_including(kind: "error", message: "Invalid response. Must be 'accept' or 'reject'")
        )
        perform(:respond_to_undo, response_data)
      end
    end
  end

  describe 'integration with game engine' do
    before do
      subscribe(id: game.id)
      allow(mock_engine).to receive(:try_play).and_return(Go::Status::Stage::PLAY)
      allow(mock_engine).to receive(:try_pass).and_return(Go::Status::Stage::PLAY)
      allow(mock_engine).to receive(:try_resign).and_return(Go::Status::Stage::DONE)
      allow(mock_engine).to receive(:result).and_return("Result")
    end

    it 'correctly integrates with Games::EngineBuilder' do
      expect(Games::EngineBuilder).to receive(:call).with(game).and_return(mock_engine)
      perform(:place_stone, { 'col' => 3, 'row' => 5 })
    end

    it 'passes correct stone color based on player role' do
      expect(mock_engine).to receive(:try_play).with(Go::Stone::BLACK, anything)
      perform(:place_stone, { 'col' => 3, 'row' => 5 })
    end

    context 'when current player is white' do
      before do
        stub_connection(current_player: other_player)
        subscribe(id: game.id)
      end

      it 'passes white stone to engine' do
        expect(mock_engine).to receive(:try_play).with(Go::Stone::WHITE, anything)
        perform(:place_stone, { 'col' => 3, 'row' => 5 })
      end
    end
  end

  describe 'auto-rejection of undo requests' do
    let!(:game_move) do
      GameMove.create!(
        game: game,
        player: player,
        stone: Go::Stone::BLACK,
        move_number: 0,
        kind: Go::MoveKind::PLAY,
        col: 3,
        row: 3
      )
    end
    let!(:undo_request) do
      UndoRequest.create!(
        game: game,
        requesting_player: player,
        target_move: game_move,
        status: UndoRequestStatus::PENDING
      )
    end

    before do
      subscribe(id: game.id)
      allow(mock_engine).to receive(:try_play).and_return(Go::Status::Stage::PLAY)
      allow(mock_engine).to receive(:try_pass).and_return(Go::Status::Stage::PLAY)
    end

    describe '#place_stone with pending undo request' do
      context 'when opponent plays a move' do
        before do
          stub_connection(current_player: other_player)
          subscribe(id: game.id)
        end

        it 'auto-rejects the undo request' do
          expect do
            perform(:place_stone, { 'col' => 4, 'row' => 4 })
          end.to change { undo_request.reload.status }.to(UndoRequestStatus::REJECTED)
        end

        it 'sets the responding player' do
          perform(:place_stone, { 'col' => 4, 'row' => 4 })
          expect(undo_request.reload.responded_by).to eq(other_player)
        end

        it 'broadcasts undo rejection' do
          expect(ActionCable.server).to receive(:broadcast).with(
            "game_#{game.id}",
            hash_including(
              kind: "undo_rejected",
              request_id: undo_request.id,
              responding_player: "Anonymous"
            )
          )
          expect(ActionCable.server).to receive(:broadcast).with(
            "game_#{game.id}",
            hash_including(kind: "state")
          )

          perform(:place_stone, { 'col' => 4, 'row' => 4 })
        end

        it 'still creates the game move' do
          expect do
            perform(:place_stone, { 'col' => 4, 'row' => 4 })
          end.to change { GameMove.count }.by(1)
        end

        it 'still broadcasts game state' do
          expect(ActionCable.server).to receive(:broadcast).with(
            "game_#{game.id}",
            hash_including(kind: "undo_rejected")
          )
          expect(ActionCable.server).to receive(:broadcast).with(
            "game_#{game.id}",
            hash_including(kind: "state")
          )

          perform(:place_stone, { 'col' => 4, 'row' => 4 })
        end
      end

      context 'when requesting player plays a move' do
        it 'does not auto-reject the undo request' do
          expect do
            perform(:place_stone, { 'col' => 4, 'row' => 4 })
          end.not_to change { undo_request.reload.status }
        end

        it 'does not broadcast undo rejection' do
          expect(subscription).not_to receive(:transmit).with(hash_including(kind: "undo_rejected"))
          perform(:place_stone, { 'col' => 4, 'row' => 4 })
        end
      end
    end

    describe '#pass with pending undo request' do
      context 'when opponent passes' do
        before do
          stub_connection(current_player: other_player)
          subscribe(id: game.id)
        end

        it 'auto-rejects the undo request' do
          expect do
            perform(:pass)
          end.to change { undo_request.reload.status }.to(UndoRequestStatus::REJECTED)
        end

        it 'sets the responding player' do
          perform(:pass)
          expect(undo_request.reload.responded_by).to eq(other_player)
        end

        it 'broadcasts undo rejection' do
          expect(ActionCable.server).to receive(:broadcast).with(
            "game_#{game.id}",
            hash_including(
              kind: "undo_rejected",
              request_id: undo_request.id,
              responding_player: "Anonymous"
            )
          )
          expect(ActionCable.server).to receive(:broadcast).with(
            "game_#{game.id}",
            hash_including(kind: "state")
          )

          perform(:pass)
        end
      end

      context 'when requesting player passes' do
        it 'does not auto-reject the undo request' do
          expect do
            perform(:pass)
          end.not_to change { undo_request.reload.status }
        end
      end
    end

    describe 'without pending undo request' do
      before do
        undo_request.update!(status: UndoRequestStatus::REJECTED, responded_by: other_player)
      end

      it 'does not attempt auto-rejection' do
        expect(UndoRequest).not_to receive(:find)
        perform(:place_stone, { 'col' => 4, 'row' => 4 })
      end
    end

    describe 'edge cases' do
      context 'when undo request is deleted during processing' do
        it 'handles missing undo request gracefully' do
          allow(game).to receive(:has_pending_undo_request?).and_return(true)
          allow(game).to receive(:undo_request).and_return(nil)

          expect do
            perform(:place_stone, { 'col' => 4, 'row' => 4 })
          end.not_to raise_error
        end
      end
    end
  end
end

