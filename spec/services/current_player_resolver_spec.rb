require 'rails_helper'

RSpec.describe CurrentPlayerResolver, type: :service do
  let(:session) { {} }
  let(:service) { described_class.new(session) }
  
  describe '#resolve!' do
    context 'when session has no player_id' do
      it 'creates a new player and sets session token' do
        allow(SecureRandom).to receive(:alphanumeric).and_return('abc123-alphanumeric')
        
        player = service.resolve!
        
        expect(player).to be_a(Player)
        expect(player.session_token).to eq('abc123-uuid')
        expect(session[:player_id]).to eq('abc123-uuid')
        expect(player).to be_persisted
      end
      
      it 'logs debug message for new player creation' do
        allow(Rails.logger).to receive(:debug)
        
        player = service.resolve!
        
        expect(Rails.logger).to have_received(:debug).with("[CurrentPlayerResolver] New player created: #{player.id}")
      end
    end
    
    context 'when session has valid player_id' do
      let!(:existing_player) { Player.create!(session_token: 'existing_token', email: 'test@example.com') }
      let(:session) { { player_id: 'existing_token' } }
      
      it 'returns the existing player' do
        player = service.resolve!
        
        expect(player).to eq(existing_player)
        expect(session[:player_id]).to eq('existing_token')
      end
      
      it 'does not create a new player' do
        expect { service.resolve! }.not_to change(Player, :count)
      end
      
      it 'does not log debug message' do
        allow(Rails.logger).to receive(:debug)
        
        service.resolve!
        
        expect(Rails.logger).not_to have_received(:debug).with(/\[CurrentPlayerResolver\] New player created:/)
      end
    end
    
    context 'when session has stale player_id' do
      let(:session) { { player_id: 'stale_token' } }
      
      it 'clears the session and creates new player' do
        allow(SecureRandom).to receive(:alphanumeric).and_return('new_token')
        
        player = service.resolve!
        
        expect(player.session_token).to eq('new_token')
        expect(session[:player_id]).to eq('new_token')
      end
      
      it 'logs warning for stale token' do
        allow(Rails.logger).to receive(:warn)
        
        service.resolve!
        
        expect(Rails.logger).to have_received(:warn).with("[CurrentPlayerResolver] Stale session token: stale_token")
      end
      
      it 'logs debug message for new player creation' do
        allow(Rails.logger).to receive(:debug)
        
        player = service.resolve!
        
        expect(Rails.logger).to have_received(:debug).with("[CurrentPlayerResolver] New player created: #{player.id}")
      end
    end
    
    context 'when session has nil player_id' do
      let(:session) { { player_id: nil } }
      
      it 'treats nil as no session and creates new player' do
        allow(SecureRandom).to receive(:alphanumeric).and_return('nil_token')
        
        player = service.resolve!
        
        expect(player.session_token).to eq('nil_token')
        expect(session[:player_id]).to eq('nil_token')
      end
    end
    
    context 'when session has empty string player_id' do
      let(:session) { { player_id: '' } }
      
      it 'treats empty string as no session and creates new player' do
        allow(SecureRandom).to receive(:alphanumeric).and_return('empty_token')
        
        player = service.resolve!
        
        expect(player.session_token).to eq('empty_token')
        expect(session[:player_id]).to eq('empty_token')
      end
    end
  end
  
  describe '#find_existing_player' do
    let!(:existing_player) { Player.create!(session_token: 'find_token', email: 'find@example.com') }
    let(:session) { { player_id: 'find_token' } }
    
    it 'returns player when found' do
      player = service.send(:find_existing_player)
      
      expect(player).to eq(existing_player)
    end
    
    it 'returns nil when player not found' do
      session[:player_id] = 'nonexistent'
      
      player = service.send(:find_existing_player)
      
      expect(player).to be_nil
    end
    
    it 'returns nil when session has no player_id' do
      session.delete(:player_id)
      
      player = service.send(:find_existing_player)
      
      expect(player).to be_nil
    end
  end
  
  describe '#create_new_player' do
    it 'creates player with generated session token' do
      allow(SecureRandom).to receive(:alphanumeric).and_return('create_token')
      
      player = service.send(:create_new_player)
      
      expect(player.session_token).to eq('create_token')
      expect(player).to be_persisted
    end
    
    it 'updates session with new token' do
      allow(SecureRandom).to receive(:alphanumeric).and_return('session_token')
      
      service.send(:create_new_player)
      
      expect(session[:player_id]).to eq('session_token')
    end
    
    it 'generates unique session tokens' do
      allow(SecureRandom).to receive(:alphanumeric).and_return('unique1', 'unique2')
      
      player1 = service.send(:create_new_player)
      player2 = described_class.new({}).send(:create_new_player)
      
      expect(player1.session_token).to eq('unique1')
      expect(player2.session_token).to eq('unique2')
    end
  end
  
  describe 'error handling' do
    it 'handles database errors during player creation' do
      allow(Player).to receive(:create!).and_raise(ActiveRecord::RecordInvalid)
      
      expect { service.resolve! }.to raise_error(ActiveRecord::RecordInvalid)
    end
    
    it 'handles session manipulation attempts' do
      session[:player_id] = 'malicious_token'
      
      expect { service.resolve! }.not_to raise_error
    end
  end
  
  describe 'session token uniqueness' do
    it 'generates different tokens for concurrent requests' do
      service1 = described_class.new({})
      service2 = described_class.new({})
      
      player1 = service1.resolve!
      player2 = service2.resolve!
      
      expect(player1.session_token).not_to eq(player2.session_token)
    end
  end
end
