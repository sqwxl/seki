require 'rails_helper'

RSpec.describe TerritoryReview, type: :model do
  let(:creator) { Player.create!(email: 'creator@example.com') }
  let(:black_player) { Player.create!(email: 'black@example.com') }
  let(:white_player) { Player.create!(email: 'white@example.com') }
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

  describe 'associations' do
    let(:territory_review) do
      TerritoryReview.create!(
        game: game,
        settled: false
      )
    end

    it 'belongs to game' do
      expect(territory_review.game).to eq(game)
    end

    it 'is the territory review for the game' do
      territory_review # trigger creation
      expect(game.reload.territory_review).to eq(territory_review)
    end
  end

  describe 'validations' do
    it 'requires game' do
      territory_review = TerritoryReview.new(settled: false)
      expect(territory_review).not_to be_valid
      expect(territory_review.errors[:game]).to include("must exist")
    end

    it 'is valid with game and settled status' do
      territory_review = TerritoryReview.new(game: game, settled: false)
      expect(territory_review).to be_valid
    end

    it 'allows settled to be true' do
      territory_review = TerritoryReview.new(game: game, settled: true)
      expect(territory_review).to be_valid
    end

    it 'allows settled to be false' do
      territory_review = TerritoryReview.new(game: game, settled: false)
      expect(territory_review).to be_valid
    end

    it 'defaults settled to false if not specified' do
      territory_review = TerritoryReview.new(game: game)
      expect(territory_review.settled).to be_falsey  # Database default is false
    end
  end

  describe 'territory review states' do
    it 'can be created as unsettled' do
      territory_review = TerritoryReview.create!(
        game: game,
        settled: false
      )

      expect(territory_review.settled).to be_falsey
    end

    it 'can be created as settled' do
      territory_review = TerritoryReview.create!(
        game: game,
        settled: true
      )

      expect(territory_review.settled).to be_truthy
    end

    it 'can be updated from unsettled to settled' do
      territory_review = TerritoryReview.create!(
        game: game,
        settled: false
      )

      territory_review.update!(settled: true)
      expect(territory_review.settled).to be_truthy
    end

    it 'can be updated from settled to unsettled' do
      territory_review = TerritoryReview.create!(
        game: game,
        settled: true
      )

      territory_review.update!(settled: false)
      expect(territory_review.settled).to be_falsey
    end
  end

  describe 'game stage integration' do
    context 'when territory review is unsettled' do
      it 'affects game stage' do
        # Add a move to get past UNSTARTED stage
        game.moves.create!(
          player: black_player,
          kind: 'play',
          stone: 'black',
          col: 3,
          row: 3
        )

        territory_review = TerritoryReview.create!(
          game: game,
          settled: false
        )

        expect(game.stage).to eq(Go::Status::Stage::TERRITORY_REVIEW)
      end
    end

    context 'when territory review is settled' do
      it 'does not affect game stage' do
        # Add a move to get past UNSTARTED stage
        game.moves.create!(
          player: black_player,
          kind: 'play',
          stone: 'black',
          col: 3,
          row: 3
        )

        territory_review = TerritoryReview.create!(
          game: game,
          settled: true
        )

        expect(game.stage).to eq(Go::Status::Stage::PLAY)
      end
    end
  end

  describe 'uniqueness' do
    it 'allows only one territory review per game' do
      TerritoryReview.create!(
        game: game,
        settled: false
      )

      second_review = TerritoryReview.new(
        game: game,
        settled: true
      )

      expect(second_review).not_to be_valid
      expect(second_review.errors[:game]).to include('has already been taken')
    end
  end

  describe 'cascading deletes' do
    it 'is deleted when game is deleted' do
      territory_review = TerritoryReview.create!(
        game: game,
        settled: false
      )

      review_id = territory_review.id
      game.destroy!

      expect(TerritoryReview.exists?(review_id)).to be_falsey
    end
  end

  describe 'timestamps' do
    it 'sets created_at when territory review is created' do
      territory_review = TerritoryReview.create!(
        game: game,
        settled: false
      )

      expect(territory_review.created_at).to be_within(1.second).of(Time.current)
    end

    it 'sets updated_at when territory review is created' do
      territory_review = TerritoryReview.create!(
        game: game,
        settled: false
      )

      expect(territory_review.updated_at).to be_within(1.second).of(Time.current)
    end

    it 'updates updated_at when territory review is modified' do
      territory_review = TerritoryReview.create!(
        game: game,
        settled: false
      )

      original_updated_at = territory_review.updated_at
      sleep(0.01)  # Ensure timestamp difference

      territory_review.update!(settled: true)
      expect(territory_review.updated_at).to be > original_updated_at
    end
  end
end