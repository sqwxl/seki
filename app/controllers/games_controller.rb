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
    @game = Game.find(params[:id])

    @engine = Games::EngineBuilder.call(@game)
  end

  def join
    @game = Game.find(params[:id])

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
    @game = Game.find(params[:id])

    token = params[:token]
    raise "missing token parameter" if token.nil?

    raise "token mismatch" if @game.invite_token != token

    email = params[:email]
    raise "missing email parameter" if email.nil?

    guest = Player.find_by(email: email)
    raise "player not found" if guest.nil?


    unless @game.players.include?(guest)
      if @game.black.nil?
        @game.update!(black: guest)
      elsif @game.white.nil?
        @game.update!(white: guest)
      end
    end

    # Update session to recognize the guest as the current player
    session[:player_id] = guest.ensure_session_token!

    redirect_to @game
  rescue => e
    Rails.logger.warn("Invite link failed: #{e.message}")
    flash.now.alert = "The invite link you used is invalid. If you copied it from the email you received, double-check that you got the whole thing."

    render :new, status: :unprocessable_entity
  end
end
