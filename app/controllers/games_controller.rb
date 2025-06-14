class GamesController < ApplicationController
  def index
  end

  def new
    @game = Game.new
  end

  def create
    @game = Game.create!

    if params[:invite_email].present?
      GameMailer.with(game: @game, email: params[:invite_email]).invite.deliver_later
    end

    redirect_to @game
  end

  def show
    @game = Game.find(params[:id])

    player_id = session[:player_id]

    if @game.player_1_id.nil?
      @game.update(player_1_id: player_id)
    elsif @game.player_2_id.nil? && @game.player_1_id != player_id
      @game.update(player_2_id: player_id)
    end

    @moves = @game.moves.order(:move_number)
  end

  private

  def game_params
    params.require(:game).permit(:board_size)
  end
end
