require 'rails_helper'

RSpec.describe Player, type: :model do
  describe 'validations' do
    context 'session_token' do
      it 'allows blank session_token' do
        player = Player.new(session_token: nil)
        expect(player).to be_valid
      end

      it 'requires unique session_token when present' do
        Player.create!(session_token: 'unique_token')
        duplicate_player = Player.new(session_token: 'unique_token')
        expect(duplicate_player).not_to be_valid
        expect(duplicate_player.errors[:session_token]).to include('has already been taken')
      end
    end

    context 'email' do
      it 'allows blank email' do
        player = Player.new(email: nil)
        expect(player).to be_valid
      end

      it 'requires unique email when present' do
        Player.create!(email: 'test@example.com')
        duplicate_player = Player.new(email: 'test@example.com')
        expect(duplicate_player).not_to be_valid
        expect(duplicate_player.errors[:email]).to include('has already been taken')
      end

      it 'validates email format' do
        valid_emails = [
          'user@example.com',
          'test.email+tag@domain.co.uk',
          'valid.email@subdomain.domain.com'
        ]
        
        valid_emails.each do |email|
          player = Player.new(email: email)
          expect(player).to be_valid, "#{email} should be valid"
        end
      end

      it 'rejects invalid email formats' do
        invalid_emails = [
          'invalid',
          'invalid@',
          '@invalid.com',
          'invalid.email',
          'spaces in@email.com'
        ]
        
        invalid_emails.each do |email|
          player = Player.new(email: email)
          expect(player).not_to be_valid, "#{email} should be invalid"
          expect(player.errors[:email]).to be_present
        end
      end
    end
  end

  describe 'associations' do
    let(:player) { Player.create!(email: 'player@example.com') }
    let(:creator) { Player.create!(email: 'creator@example.com') }
    let(:other_player) { Player.create!(email: 'other@example.com') }

    it 'has many moves' do
      expect(player).to respond_to(:moves)
      expect(player.moves).to be_empty
    end

    it 'has many games' do
      expect(player).to respond_to(:games)
      expect(player.games).to be_empty
    end

    context 'games association' do
      let(:game_as_black) do
        Game.create!(
          creator: creator,
          black: player,
          white: other_player,
          cols: 19,
          rows: 19,
          komi: 6.5,
          handicap: 2
        )
      end

      let(:game_as_white) do
        Game.create!(
          creator: creator,
          black: other_player,
          white: player,
          cols: 19,
          rows: 19,
          komi: 6.5,
          handicap: 2
        )
      end

      it 'includes games where player is black' do
        game_as_black
        expect(player.games).to include(game_as_black)
      end

      it 'includes games where player is white' do
        game_as_white
        expect(player.games).to include(game_as_white)
      end

      it 'includes both games where player participates' do
        game_as_black
        game_as_white
        expect(player.games).to contain_exactly(game_as_black, game_as_white)
      end

      it 'does not include games where player is not participating' do
        other_game = Game.create!(
          creator: creator,
          black: creator,
          white: other_player,
          cols: 19,
          rows: 19,
          komi: 6.5,
          handicap: 2
        )
        expect(player.games).not_to include(other_game)
      end
    end
  end

  describe 'creation' do
    it 'can be created with minimal attributes' do
      player = Player.create!
      expect(player).to be_persisted
      expect(player.session_token).to be_nil
      expect(player.email).to be_nil
    end

    it 'can be created with session_token' do
      player = Player.create!(session_token: 'abc123')
      expect(player.session_token).to eq('abc123')
    end

    it 'can be created with email' do
      player = Player.create!(email: 'test@example.com')
      expect(player.email).to eq('test@example.com')
    end

    it 'can be created with both session_token and email' do
      player = Player.create!(
        session_token: 'abc123',
        email: 'test@example.com'
      )
      expect(player.session_token).to eq('abc123')
      expect(player.email).to eq('test@example.com')
    end
  end
end