require "rails_helper"

RSpec.describe UndoRequest, type: :model do
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
  let(:game_move) do
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

  describe "validations" do
    subject do
      UndoRequest.new(
        game: game,
        requesting_player: creator,
        target_move: game_move,
        status: UndoRequestStatus::PENDING
      )
    end

    it { should be_valid }

    describe "status validation" do
      it "validates status is in allowed values" do
        valid_statuses = UndoRequestStatus::ALL
        expect(valid_statuses).to include(subject.status)
      end

      it "rejects invalid status" do
        subject.status = "invalid_status"
        expect(subject).to be_invalid
        expect(subject.errors[:status]).to include("is not included in the list")
      end
    end

    describe "requesting_player validation" do
      it "requires requesting_player" do
        subject.requesting_player = nil
        expect(subject).to be_invalid
        expect(subject.errors[:requesting_player]).to include("can't be blank")
      end
    end

    describe "target_move validation" do
      it "requires target_move" do
        subject.target_move = nil
        expect(subject).to be_invalid
        expect(subject.errors[:target_move]).to include("can't be blank")
      end
    end

    describe "target_move_belongs_to_game validation" do
      it "validates target_move belongs to the same game" do
        other_game = Game.create!(
          creator: opponent,
          black: opponent,
          white: creator,
          cols: 19,
          rows: 19,
          komi: 6.5,
          handicap: 2
        )
        other_move = GameMove.create!(
          game: other_game,
          player: opponent,
          stone: Go::Stone::BLACK,
          move_number: 0,
          kind: Go::MoveKind::PLAY,
          col: 3,
          row: 3
        )

        subject.target_move = other_move
        expect(subject).to be_invalid
        expect(subject.errors[:target_move]).to include("must belong to the same game")
      end
    end

    describe "target_move_is_last_move validation" do
      it "validates target_move is the last move" do
        # Create another move after the target move
        GameMove.create!(
          game: game,
          player: opponent,
          stone: Go::Stone::WHITE,
          move_number: 1,
          kind: Go::MoveKind::PLAY,
          col: 4,
          row: 4
        )

        expect(subject).to be_invalid
        expect(subject.errors[:target_move]).to include("must be the last move")
      end
    end

    describe "requesting_player_owns_target_move validation" do
      it "validates requesting player owns the target move" do
        subject.requesting_player = opponent
        expect(subject).to be_invalid
        expect(subject.errors[:requesting_player]).to include("must own the target move")
      end
    end

    describe "game_allows_undo_request validation" do
      it "validates game is in play stage" do
        allow(game).to receive(:stage).and_return(Go::Status::Stage::DONE)
        expect(subject).to be_invalid
        expect(subject.errors[:game]).to include("must be in play stage")
      end

      it "validates game has at least one move" do
        # Create a request without a move
        empty_game = Game.create!(
          creator: creator,
          black: creator,
          white: opponent,
          cols: 19,
          rows: 19,
          komi: 6.5,
          handicap: 2
        )
        empty_request = UndoRequest.new(
          game: empty_game,
          requesting_player: creator,
          target_move: game_move, # This will fail validation
          status: UndoRequestStatus::PENDING
        )

        expect(empty_request).to be_invalid
        expect(empty_request.errors[:game]).to include("must have at least one move")
      end
    end
  end

  describe "associations" do
    let(:undo_request) do
      UndoRequest.create!(
        game: game,
        requesting_player: creator,
        target_move: game_move,
        status: UndoRequestStatus::PENDING
      )
    end

    it "belongs to game" do
      expect(undo_request.game).to eq(game)
    end

    it "belongs to requesting_player" do
      expect(undo_request.requesting_player).to eq(creator)
    end

    it "belongs to target_move" do
      expect(undo_request.target_move).to eq(game_move)
    end

    it "optionally belongs to responded_by" do
      expect(undo_request.responded_by).to be_nil
      undo_request.update!(responded_by: opponent)
      expect(undo_request.responded_by).to eq(opponent)
    end
  end

  describe "scopes" do
    let!(:pending_request) do
      UndoRequest.create!(
        game: game,
        requesting_player: creator,
        target_move: game_move,
        status: UndoRequestStatus::PENDING
      )
    end

    # Create a separate game for the accepted request due to unique constraint
    let(:other_game) do
      Game.create!(
        creator: opponent,
        black: opponent,
        white: creator,
        cols: 19,
        rows: 19,
        komi: 6.5,
        handicap: 2
      )
    end
    let!(:accepted_request) do
      other_move = GameMove.create!(
        game: other_game,
        player: opponent,
        stone: Go::Stone::BLACK,
        move_number: 0,
        kind: Go::MoveKind::PLAY,
        col: 4,
        row: 4
      )
      UndoRequest.create!(
        game: other_game,
        requesting_player: opponent,
        target_move: other_move,
        status: UndoRequestStatus::ACCEPTED,
        responded_by: creator
      )
    end

    describe ".pending" do
      it "returns only pending requests" do
        expect(UndoRequest.pending).to contain_exactly(pending_request)
      end
    end

    describe ".for_game" do
      it "returns requests for the specified game" do
        expect(UndoRequest.for_game(game)).to contain_exactly(pending_request)
        expect(UndoRequest.for_game(other_game)).to contain_exactly(accepted_request)
      end
    end
  end

  describe "instance methods" do
    let(:undo_request) do
      UndoRequest.create!(
        game: game,
        requesting_player: creator,
        target_move: game_move,
        status: UndoRequestStatus::PENDING
      )
    end

    describe "#accept!" do
      it "updates status to accepted and sets responded_by before destroying move" do
        # Track the changes during the accept! process
        status_changes = []
        responded_by_changes = []

        # Override the update! method to capture changes
        allow(undo_request).to receive(:update!) do |attrs|
          status_changes << attrs[:status] if attrs.key?(:status)
          responded_by_changes << attrs[:responded_by] if attrs.key?(:responded_by)
          undo_request.status = attrs[:status] if attrs.key?(:status)
          undo_request.responded_by = attrs[:responded_by] if attrs.key?(:responded_by)
        end

        undo_request.accept!(opponent)

        expect(status_changes).to include(UndoRequestStatus::ACCEPTED)
        expect(responded_by_changes).to include(opponent)
      end

      it "destroys the target move" do
        target_move_id = undo_request.target_move.id
        expect { undo_request.accept!(opponent) }
          .to change { GameMove.exists?(target_move_id) }.from(true).to(false)
      end

      it "raises error if already responded to" do
        undo_request.update!(status: UndoRequestStatus::ACCEPTED, responded_by: opponent)
        expect { undo_request.accept!(opponent) }
          .to raise_error("Undo request already responded to")
      end

      it "raises error if wrong player responds" do
        expect { undo_request.accept!(creator) }
          .to raise_error("Only opponent can respond to undo request")
      end
    end

    describe "#reject!" do
      it "updates status to rejected and sets responded_by" do
        expect { undo_request.reject!(opponent) }
          .to change { undo_request.reload.status }.to(UndoRequestStatus::REJECTED)
          .and change { undo_request.reload.responded_by }.to(opponent)
      end

      it "does not destroy the target move" do
        expect { undo_request.reject!(opponent) }
          .not_to change { GameMove.exists?(game_move.id) }
      end

      it "raises error if already responded to" do
        undo_request.update!(status: UndoRequestStatus::REJECTED, responded_by: opponent)
        expect { undo_request.reject!(opponent) }
          .to raise_error("Undo request already responded to")
      end

      it "raises error if wrong player responds" do
        expect { undo_request.reject!(creator) }
          .to raise_error("Only opponent can respond to undo request")
      end
    end

    describe "#pending?" do
      it "returns true for pending requests" do
        expect(undo_request.pending?).to be true
      end

      it "returns false for accepted requests" do
        undo_request.update!(status: UndoRequestStatus::ACCEPTED, responded_by: opponent)
        expect(undo_request.pending?).to be false
      end

      it "returns false for rejected requests" do
        undo_request.update!(status: UndoRequestStatus::REJECTED, responded_by: opponent)
        expect(undo_request.pending?).to be false
      end
    end

    describe "#accepted?" do
      it "returns true for accepted requests" do
        undo_request.update!(status: UndoRequestStatus::ACCEPTED, responded_by: opponent)
        expect(undo_request.accepted?).to be true
      end

      it "returns false for pending requests" do
        expect(undo_request.accepted?).to be false
      end

      it "returns false for rejected requests" do
        undo_request.update!(status: UndoRequestStatus::REJECTED, responded_by: opponent)
        expect(undo_request.accepted?).to be false
      end
    end

    describe "#rejected?" do
      it "returns true for rejected requests" do
        undo_request.update!(status: UndoRequestStatus::REJECTED, responded_by: opponent)
        expect(undo_request.rejected?).to be true
      end

      it "returns false for pending requests" do
        expect(undo_request.rejected?).to be false
      end

      it "returns false for accepted requests" do
        undo_request.update!(status: UndoRequestStatus::ACCEPTED, responded_by: opponent)
        expect(undo_request.rejected?).to be false
      end
    end

    describe "#can_respond?" do
      it "returns true for the opponent player" do
        expect(undo_request.can_respond?(opponent)).to be true
      end

      it "returns false for the requesting player" do
        expect(undo_request.can_respond?(creator)).to be false
      end

      it "returns false for players not in the game" do
        other_player = Player.create!(email: 'other@example.com')
        expect(undo_request.can_respond?(other_player)).to be false
      end
    end
  end
end