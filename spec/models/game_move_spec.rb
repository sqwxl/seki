require 'rails_helper'

RSpec.describe GameMove, type: :model do
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

  describe 'validations' do
    it 'requires game' do
      move = GameMove.new(player: black_player, stone: 'black', kind: 'play')
      expect(move).not_to be_valid
      expect(move.errors[:game]).to include("must exist")
    end

    it 'requires player' do
      move = GameMove.new(game: game, stone: 'black', kind: 'play')
      expect(move).not_to be_valid
      expect(move.errors[:player]).to include("must exist")
    end

    it 'requires stone' do
      move = GameMove.new(game: game, player: black_player, kind: 'play')
      expect(move).not_to be_valid
      expect(move.errors[:stone]).to include("can't be blank")
    end

    it 'requires kind' do
      move = GameMove.new(game: game, player: black_player, stone: 'black')
      expect(move).not_to be_valid
      expect(move.errors[:kind]).to include("can't be blank")
    end

    it 'validates kind is in allowed values' do
      valid_kinds = %w[play pass resign]
      valid_kinds.each do |kind|
        move = GameMove.new(game: game, player: black_player, stone: 'black', kind: kind)
        expect(move).to be_valid, "#{kind} should be valid"
      end
    end

    it 'rejects invalid kind values' do
      invalid_kinds = %w[invalid_move capture illegal]
      invalid_kinds.each do |kind|
        move = GameMove.new(game: game, player: black_player, stone: 'black', kind: kind)
        expect(move).not_to be_valid, "#{kind} should be invalid"
        expect(move.errors[:kind]).to be_present
      end
    end
  end

  describe 'associations' do
    let(:move) do
      GameMove.create!(
        game: game,
        player: black_player,
        stone: Go::Stone::BLACK,
        kind: 'play',
        col: 3,
        row: 3
      )
    end

    it 'belongs to game' do
      expect(move.game).to eq(game)
    end

    it 'belongs to player' do
      expect(move.player).to eq(black_player)
    end

    it 'has inverse relationship with game moves' do
      expect(game.moves).to include(move)
    end
  end

  describe 'move creation' do
    it 'can create a play move with coordinates' do
      move = GameMove.create!(
        game: game,
        player: black_player,
        stone: Go::Stone::BLACK,
        kind: 'play',
        col: 10,
        row: 15
      )

      expect(move).to be_persisted
      expect(move.kind).to eq('play')
      expect(move.col).to eq(10)
      expect(move.row).to eq(15)
    end

    it 'can create a pass move without coordinates' do
      move = GameMove.create!(
        game: game,
        player: black_player,
        stone: Go::Stone::BLACK,
        kind: 'pass'
      )

      expect(move).to be_persisted
      expect(move.kind).to eq('pass')
      expect(move.col).to be_nil
      expect(move.row).to be_nil
    end

    it 'can create a resign move' do
      move = GameMove.create!(
        game: game,
        player: black_player,
        stone: Go::Stone::BLACK,
        kind: 'resign'
      )

      expect(move).to be_persisted
      expect(move.kind).to eq('resign')
    end
  end

  describe 'move_number callback' do
    context 'when creating first move' do
      it 'sets move_number to 0' do
        move = GameMove.create!(
          game: game,
          player: black_player,
          stone: Go::Stone::BLACK,
          kind: 'play',
          col: 3,
          row: 3
        )

        expect(move.move_number).to eq(0)
      end
    end

    context 'when creating subsequent moves' do
      before do
        GameMove.create!(
          game: game,
          player: black_player,
          stone: Go::Stone::BLACK,
          kind: 'play',
          col: 3,
          row: 3
        )
      end

      it 'sets move_number based on existing moves count' do
        second_move = GameMove.create!(
          game: game,
          player: white_player,
          stone: Go::Stone::WHITE,
          kind: 'play',
          col: 15,
          row: 15
        )

        expect(second_move.move_number).to eq(1)
      end

      it 'continues incrementing for multiple moves' do
        moves = []
        5.times do |i|
          moves << GameMove.create!(
            game: game,
            player: i.even? ? white_player : black_player,
            stone: i.even? ? 'white' : 'black',
            kind: 'play',
            col: i + 5,
            row: i + 5
          )
        end

        expect(moves.map(&:move_number)).to eq([1, 2, 3, 4, 5])
      end
    end

    context 'when move_number is explicitly set' do
      it 'does not override explicit move_number' do
        move = GameMove.new(
          game: game,
          player: black_player,
          stone: Go::Stone::BLACK,
          kind: 'play',
          col: 3,
          row: 3,
          move_number: 99
        )
        move.save!

        expect(move.move_number).to eq(99)
      end
    end
  end

  describe 'stone colors' do
    it 'accepts black stone' do
      move = GameMove.create!(
        game: game,
        player: black_player,
        stone: Go::Stone::BLACK,
        kind: 'play',
        col: 3,
        row: 3
      )

      expect(move.stone).to eq(Go::Stone::BLACK)
    end

    it 'accepts white stone' do
      move = GameMove.create!(
        game: game,
        player: white_player,
        stone: Go::Stone::WHITE,
        kind: 'play',
        col: 3,
        row: 3
      )

      expect(move.stone).to eq(Go::Stone::WHITE)
    end
  end

  describe 'coordinate bounds' do
    it 'allows coordinates within board bounds' do
      (0..18).each do |coord|
        move = GameMove.create!(
          game: game,
          player: black_player,
          stone: Go::Stone::BLACK,
          kind: 'play',
          col: coord,
          row: coord
        )
        expect(move).to be_valid
      end
    end

    it 'allows coordinates at board edges' do
      edge_moves = [
        { col: 0, row: 0 },     # top-left
        { col: 18, row: 0 },    # top-right
        { col: 0, row: 18 },    # bottom-left
        { col: 18, row: 18 }    # bottom-right
      ]

      edge_moves.each_with_index do |coords, index|
        move = GameMove.create!(
          game: game,
          player: index.even? ? black_player : white_player,
          stone: index.even? ? 'black' : 'white',
          kind: 'play',
          **coords
        )
        expect(move).to be_valid
      end
    end
  end

  describe 'move ordering' do
    it 'orders moves by creation time by default' do
      first_move = GameMove.create!(
        game: game,
        player: black_player,
        stone: Go::Stone::BLACK,
        kind: 'play',
        col: 3,
        row: 3
      )

      second_move = GameMove.create!(
        game: game,
        player: white_player,
        stone: Go::Stone::WHITE,
        kind: 'play',
        col: 15,
        row: 15
      )

      expect(game.moves.pluck(:id)).to eq([first_move.id, second_move.id])
    end
  end
end