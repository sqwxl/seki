class GamesController < ApplicationController
  def index
  end

  def new
    @game = Game.new
  end

  def create
    @game = Games::Creator.call(current_player, params)

    redirect_to @game
  rescue ActiveRecord::RecordInvalid => e
    Rails.logger.error e.message
    @game = e.record
    flash.now.alert = e.record.errors.full_messages.to_sentence

    render :new, status: :unprocessable_entity
  end

  def show
    @game = Game.with_players.find(params[:id])
  end

  def join
    @game = Game.with_players.find(params[:id])

    unless @game.players.include?(current_player)
      if @game.black.nil?
        @game.update!(black: current_player)
      elsif @game.white.nil?
        @game.update!(white: current_player)
      end
    end

    redirect_to @game
  end

  def invitation
    @game = Game.with_players.find(params[:id])

    if current_player && @game.players.include?(current_player)
      redirect_to @game
    end

    # Validate required parameters
    token = params.require(:token)
    email = params.require(:email)
    

    # Verify invitation token matches
    unless secure_compare(@game.invite_token.to_s, token.to_s)
      raise "Invalid invitation token"
    end

    # Validate email format
    unless email.match?(URI::MailTo::EMAIL_REGEXP)
      raise "Invalid email format"
    end

    guest = Player.find_by(email: email)
    if guest.nil?
      raise "Player with email #{email} not found"
    end

    # Verify the invitation is still valid (not expired, game not full, etc.)
    if @game.black.present? && @game.white.present?
      raise "Game is already full"
    end

    # Only allow session transfer if no current player or current player is not in this game
    current_player_in_game = current_player && @game.players.include?(current_player)
    if current_player_in_game && current_player != guest
      raise "You are already logged in as a different player in this game"
    end

    # Add guest to game if not already a player
    if @game.black.nil?
      @game.update!(black: guest)
    elsif @game.white.nil?
      @game.update!(white: guest)
    end

    # Only update session if guest is not the current player
    if current_player != guest
      # Log the session transfer for security auditing
      Rails.logger.info("Session transferred from #{current_player&.id || 'anonymous'} to #{guest.id} for game #{@game.id}")
      
      # Update session to the invited player
      session[:player_id] = guest.ensure_session_token!
    end

    redirect_to @game
  rescue => e
    Rails.logger.warn("Invite link failed: #{e.message}")
    flash.now.alert = "The invite link you used is invalid. If you copied it from the email you received, double-check that you got the whole thing."

    render :new, status: :unprocessable_entity
  end
end
