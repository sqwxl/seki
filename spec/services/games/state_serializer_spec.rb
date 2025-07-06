require "rails_helper"

RSpec.describe Games::StateSerializer do
  let(:creator) { Player.create!(email: 'creator@example.com') }
  let(:opponent) { Player.create!(email: 'opponent@example.com') }
  let(:game) do
    Game.create!(
      creator: creator,
      black: creator,
      white: opponent,
      cols: 19,
      rows: 19,
      komi: 6.5,
      handicap: 2
    )
  end
  let(:engine) { Games::EngineBuilder.call(game) }

  describe ".call" do
    subject { described_class.call(game, engine) }

    it "returns the expected structure" do
      expect(subject).to have_key(:stage)
      expect(subject).to have_key(:state)
      expect(subject).to have_key(:negotiations)
    end

    it "includes the game stage" do
      expect(subject[:stage]).to eq(game.stage)
    end

    it "includes the engine state" do
      expect(subject[:state]).to eq(engine.serialize)
    end

    context "without any negotiations" do
      it "returns empty negotiations hash" do
        expect(subject[:negotiations]).to eq({})
      end
    end

    context "with pending undo request" do
      let!(:game_move) do
        GameMove.create!(
          game: game,
          player: creator,
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
          requesting_player: creator,
          target_move: game_move,
          status: UndoRequestStatus::PENDING
        )
      end

      it "includes undo request in negotiations" do
        expect(subject[:negotiations]).to have_key(:undo_request)
      end

      it "includes correct undo request data" do
        undo_data = subject[:negotiations][:undo_request]

        expect(undo_data[:id]).to eq(undo_request.id)
        expect(undo_data[:requesting_player]).to eq("Anonymous")
        expect(undo_data[:target_move_number]).to eq(game_move.move_number)
        expect(undo_data[:status]).to eq(UndoRequestStatus::PENDING)
      end

      it "uses player username when available" do
        creator.update!(username: "TestPlayer")
        undo_data = subject[:negotiations][:undo_request]

        expect(undo_data[:requesting_player]).to eq("TestPlayer")
      end
    end

    context "with settled undo request" do
      let!(:game_move) do
        GameMove.create!(
          game: game,
          player: creator,
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
          requesting_player: creator,
          target_move: game_move,
          status: UndoRequestStatus::REJECTED,
          responded_by: opponent
        )
      end

      it "does not include settled undo request in negotiations" do
        expect(subject[:negotiations]).not_to have_key(:undo_request)
      end
    end

    context "with territory review" do
      let!(:territory_review) { TerritoryReview.create!(game: game, settled: false) }

      before do
        allow(game).to receive(:stage).and_return(Go::Status::Stage::TERRITORY_REVIEW)
      end

      it "includes territory review in negotiations" do
        expect(subject[:negotiations]).to have_key(:territory_review)
      end

      it "includes correct territory review data" do
        territory_data = subject[:negotiations][:territory_review]

        expect(territory_data[:id]).to eq(territory_review.id)
        expect(territory_data[:settled]).to eq(false)
      end
    end

    context "with settled territory review" do
      let!(:territory_review) { TerritoryReview.create!(game: game, settled: true) }

      it "does not include settled territory review in negotiations" do
        expect(subject[:negotiations]).not_to have_key(:territory_review)
      end
    end

    context "with multiple negotiations" do
      let!(:game_move) do
        GameMove.create!(
          game: game,
          player: creator,
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
          requesting_player: creator,
          target_move: game_move,
          status: UndoRequestStatus::PENDING
        )
      end
      let!(:territory_review) { TerritoryReview.create!(game: game, settled: false) }

      it "includes both negotiations" do
        expect(subject[:negotiations]).to have_key(:undo_request)
        expect(subject[:negotiations]).to have_key(:territory_review)
      end
    end
  end

  describe "integration with game model" do
    context "when game has no pending undo request" do
      it "calls has_pending_undo_request? correctly" do
        expect(game).to receive(:has_pending_undo_request?).and_return(false)
        described_class.call(game, engine)
      end
    end

    context "when game has pending undo request" do
      let!(:game_move) do
        GameMove.create!(
          game: game,
          player: creator,
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
          requesting_player: creator,
          target_move: game_move,
          status: UndoRequestStatus::PENDING
        )
      end

      it "calls undo_request association correctly" do
        expect(game).to receive(:undo_request).at_least(:once).and_return(undo_request)
        described_class.call(game, engine)
      end
    end
  end

  describe "private methods" do
    let(:serializer) { described_class.new(game, engine) }

    describe "#build_negotiations" do
      it "is called during serialization" do
        expect(serializer).to receive(:build_negotiations).and_call_original
        serializer.call
      end
    end

    describe "#build_undo_request_state" do
      let!(:game_move) do
        GameMove.create!(
          game: game,
          player: creator,
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
          requesting_player: creator,
          target_move: game_move,
          status: UndoRequestStatus::PENDING
        )
      end

      it "is called when undo request is pending" do
        expect(serializer).to receive(:build_undo_request_state).and_call_original
        serializer.call
      end
    end

    describe "#build_territory_review_state" do
      let!(:territory_review) { TerritoryReview.create!(game: game, settled: false) }

      before do
        allow(game).to receive(:territory_review).and_return(territory_review)
      end

      it "is called when territory review is active" do
        expect(serializer).to receive(:build_territory_review_state).and_call_original
        serializer.call
      end
    end
  end

  describe "error handling" do
    context "when engine is nil" do
      it "raises an error" do
        expect { described_class.call(game, nil) }.to raise_error(NoMethodError)
      end
    end

    context "when game is nil" do
      it "raises an error" do
        expect { described_class.call(nil, engine) }.to raise_error(NoMethodError)
      end
    end
  end
end