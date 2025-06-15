class CurrentPlayerResolver
  def initialize(session)
    @session = session
  end

  def resolve!
    find_existing_player || create_new_player
  end

  private

  def find_existing_player
    return unless @session[:player_id]

    player = Player.find_by(session_token: @session[:player_id])
    if player.nil?
      Rails.logger.warn "[CurrentPlayerResolver] Stale session token: #{@session[:player_id]}"
      @session.delete(:player_id)
    end

    player
  end

  def create_new_player
    token = SecureRandom.uuid
    player = Player.create!(session_token: token)
    @session[:player_id] = token
    Rails.logger.debug "[CurrentPlayerResolver] New player created: #{player.id}"
    player
  end
end
