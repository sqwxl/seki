require 'rails_helper'

RSpec.describe Game, type: :model do
  let(:creator) { Player.create!(email: 'creator@example.com') }
  let(:black_player) { Player.create!(email: 'black@example.com') }
  let(:white_player) { Player.create!(email: 'white@example.com') }

  describe 'validations' do
    context 'creator' do
      it 'requires a creator' do
        game = Game.new(cols: 19, rows: 19, komi: 6.5, handicap: 2)
        expect(game).not_to be_valid
        expect(game.errors[:creator]).to include("can't be blank")
      end
    end

    context 'board dimensions' do
      it 'requires cols to be an integer >= 2' do
        [ 1, 0, -1 ].each do |invalid_cols|
          game = Game.new(creator: creator, cols: invalid_cols, rows: 19, komi: 6.5, handicap: 2)
          expect(game).not_to be_valid
          expect(game.errors[:cols]).to be_present
        end
      end

      it 'requires rows to be an integer >= 2' do
        [ 1, 0, -1 ].each do |invalid_rows|
          game = Game.new(creator: creator, cols: 19, rows: invalid_rows, komi: 6.5, handicap: 2)
          expect(game).not_to be_valid
          expect(game.errors[:rows]).to be_present
        end
      end

      it 'accepts valid board dimensions' do
        [ 2, 9, 13, 19 ].each do |valid_size|
          game = Game.new(creator: creator, cols: valid_size, rows: valid_size, komi: 6.5, handicap: 2)
          expect(game).to be_valid
        end
      end
    end

    context 'komi' do
      it 'requires komi to be present' do
        game = Game.new(creator: creator, cols: 19, rows: 19, komi: nil, handicap: 2)
        expect(game).not_to be_valid
        expect(game.errors[:komi]).to include("can't be blank")
      end
    end

    context 'handicap' do
      it 'requires handicap to be an integer >= 2' do
        [ 1, 0, -1 ].each do |invalid_handicap|
          game = Game.new(creator: creator, cols: 19, rows: 19, komi: 6.5, handicap: invalid_handicap)
          expect(game).not_to be_valid
          expect(game.errors[:handicap]).to be_present
        end
      end
    end

    context 'result' do
      it 'must be absent on create' do
        game = Game.new(creator: creator, cols: 19, rows: 19, komi: 6.5, handicap: 2, result: 'B+5.5')
        expect(game).not_to be_valid
        expect(game.errors[:result]).to include('must be blank')
      end

      it 'can be present on update' do
        game = Game.create!(creator: creator, cols: 19, rows: 19, komi: 6.5, handicap: 2)
        game.update(result: 'B+5.5')
        expect(game).to be_valid
      end
    end
  end

  describe 'associations' do
    let(:game) do
      Game.create!(
        creator: creator,
        black: black_player,
        white: white_player,
        cols: 19,
        rows: 19,
        komi: 6.5,
        handicap: 2
      )
    end

    it 'belongs to creator' do
      expect(game.creator).to eq(creator)
    end

    it 'belongs to black player (optional)' do
      expect(game.black).to eq(black_player)

      # Test optional nature
      game_without_black = Game.create!(
        creator: creator,
        white: white_player,
        cols: 19,
        rows: 19,
        komi: 6.5,
        handicap: 2
      )
      expect(game_without_black.black).to be_nil
      expect(game_without_black).to be_valid
    end

    it 'belongs to white player (optional)' do
      expect(game.white).to eq(white_player)

      # Test optional nature
      game_without_white = Game.create!(
        creator: creator,
        black: black_player,
        cols: 19,
        rows: 19,
        komi: 6.5,
        handicap: 2
      )
      expect(game_without_white.white).to be_nil
      expect(game_without_white).to be_valid
    end

    it 'has many messages' do
      expect(game).to respond_to(:messages)
      expect(game.messages).to be_empty
    end

    it 'has many moves' do
      expect(game).to respond_to(:moves)
      expect(game.moves).to be_empty
    end

    it 'has one territory review' do
      expect(game).to respond_to(:territory_review)
      expect(game.territory_review).to be_nil
    end

    it 'destroys dependent associations' do
      message = game.messages.create!(text: 'test', player: creator)
      move = game.moves.create!(player: black_player, kind: 'play', stone: Go::Stone::BLACK, col: 3, row: 3)

      expect { game.destroy! }.not_to raise_error
      expect(Message.exists?(message.id)).to be_falsey
      expect(GameMove.exists?(move.id)).to be_falsey
    end
  end

  describe 'instance methods' do
    let(:game) do
      Game.create!(
        creator: creator,
        black: black_player,
        white: white_player,
        cols: 19,
        rows: 19,
        komi: 6.5,
        handicap: 2
      )
    end

    describe '#players' do
      it 'returns array of black and white players' do
        expect(game.players).to eq([ black_player, white_player ])
      end

      it 'includes nil players in the array' do
        game_partial = Game.create!(
          creator: creator,
          black: black_player,
          cols: 19,
          rows: 19,
          komi: 6.5,
          handicap: 2
        )
        expect(game_partial.players).to eq([ black_player, nil ])
      end
    end

    describe '#player_stone' do
      it 'returns BLACK for black player' do
        expect(game.player_stone(black_player)).to eq(Go::Stone::BLACK)
      end

      it 'returns WHITE for white player' do
        expect(game.player_stone(white_player)).to eq(Go::Stone::WHITE)
      end

      it 'raises error for non-participating player' do
        other_player = Player.create!(email: 'other@example.com')
        expect { game.player_stone(other_player) }.to raise_error(/Player not part of game/)
      end
    end

    describe '#stage' do
      it 'returns UNSTARTED when no moves exist' do
        expect(game.stage).to eq(Go::Status::Stage::UNSTARTED)
      end

      it 'returns FINISHED when result is present' do
        game.update!(result: 'B+5.5')
        expect(game.stage).to eq(Go::Status::Stage::DONE)
      end

      it 'returns PLAY when moves exist but no result' do
        game.moves.create!(player: black_player, kind: 'play', stone: Go::Stone::BLACK, col: 3, row: 3)
        expect(game.stage).to eq(Go::Status::Stage::PLAY)
      end

      it 'returns TERRITORY_REVIEW when territory review exists and not settled' do
        game.moves.create!(player: black_player, kind: 'play', stone: Go::Stone::BLACK, col: 3, row: 3)
        game.create_territory_review!(settled: false)
        expect(game.stage).to eq(Go::Status::Stage::TERRITORY_REVIEW)
      end

      it 'returns PLAY when territory review is settled' do
        game.moves.create!(player: black_player, kind: 'play', stone: Go::Stone::BLACK, col: 3, row: 3)
        game.create_territory_review!(settled: true)
        expect(game.stage).to eq(Go::Status::Stage::PLAY)
      end
    end

    describe '#can_request_undo?' do
      it "returns false if game stage isn't PLAY" do
        game.update!(result: 'B+5.5')
        expect(game.can_request_undo?(black_player)).to be false
      end

      it 'returns false if the player is part of players' do
        expect(game.can_request_undo?(-1)).to be false
      end

      it 'returns false if the last move isn\'t of kind PLAY' do
        game.moves.create!(player: black_player, kind: Go::MoveKind::PASS, stone: Go::Stone::BLACK)
        expect(game.can_request_undo?(black_player)).to be false
      end

      it 'returns false if there is already a pending undo request' do
        move = game.moves.create!(player: black_player, kind: Go::MoveKind::PLAY, stone: Go::Stone::BLACK, col: 0, row: 0)
        game.undo_request = UndoRequest.create!(game:, requesting_player: black_player, target_move: move)
        expect(game.can_request_undo?(black_player)).to be false
      end

      it 'returns true otherwise' do
        game.moves.create!(player: black_player, kind: Go::MoveKind::PLAY, stone: Go::Stone::BLACK, col: 0, row: 0)
        expect(game.can_request_undo?(black_player)).to be true
      end
    end
  end

  describe 'callbacks' do
    context 'after_create_commit' do
      it 'sends invite email when white player has email' do
        expect do
          Game.create!(
            creator: creator,
            black: black_player,
            white: white_player,
            cols: 19,
            rows: 19,
            komi: 6.5,
            handicap: 2
          )
        end.to have_enqueued_job(ActionMailer::MailDeliveryJob)
      end

      it 'sends invite email when black player has email and is not creator' do
        expect do
          Game.create!(
            creator: white_player,
            black: black_player,
            white: white_player,
            cols: 19,
            rows: 19,
            komi: 6.5,
            handicap: 2
          )
        end.to have_enqueued_job(ActionMailer::MailDeliveryJob)
      end

      it 'does not send email when players have no email' do
        playerless_creator = Player.create!
        playerless_black = Player.create!
        playerless_white = Player.create!

        expect do
          Game.create!(
            creator: playerless_creator,
            black: playerless_black,
            white: playerless_white,
            cols: 19,
            rows: 19,
            komi: 6.5,
            handicap: 2
          )
        end.not_to have_enqueued_job(ActionMailer::MailDeliveryJob)
      end
    end
  end

  describe 'cached_engine_state' do
    let(:game) do
      Game.create!(
        creator: creator,
        black: black_player,
        white: white_player,
        cols: 19,
        rows: 19,
        komi: 6.5,
        handicap: 2
      )
    end

    it 'allows cached_engine_state to be set' do
      cache_data = { 'move_count' => 5, 'board_state' => 'some_data' }
      game.update!(cached_engine_state: cache_data)
      expect(game.reload.cached_engine_state).to eq(cache_data)
    end

    it 'allows cached_engine_state to be nil' do
      game.update!(cached_engine_state: nil)
      expect(game.reload.cached_engine_state).to be_nil
    end
  end
end
