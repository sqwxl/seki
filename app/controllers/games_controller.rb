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

  private

  def find_or_create_session_player
    if session[:player_id]
      Player.find(session[:player_id])
    end
  end
end
