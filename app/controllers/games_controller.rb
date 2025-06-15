class GamesController < ApplicationController
  def index
  end

  def new
    @game = Game.new
  end

  def create
    @game = Game.create!

    current = current_player
    Rails.logger.debug ">>> IN CREATE ACTION <<<"

    if params[:email].present? && current.email.blank?
      current.update(email: params[:email])
    end

    friend = Player.find_or_create_by(email: params[:invite_email]) if params[:invite_email].present?

    color = case params[:color]
    when "black", "white" then params[:color]
    when "nigiri" then %w[black white].sample
    else "black"
    end

    if color == "black"
      @game.update(
        player_black_id: current.id,
        player_white_id: friend&.id
      )
    else
      @game.update(
        player_black_id: friend&.id,
        player_white_id: current.id
      )
    end

    if friend&.email.present?
      GameMailer.with(game: @game, email: friend.email).invite.deliver_later
    end

    redirect_to @game
  end

  def show
    @game = Game.find(params[:id])

    @engine = Go::Engine.new(cols: @game.cols, rows: @game.rows, moves: @game.moves.to_a)

    @moves = @game.moves.order(:move_number)
  end

  private

  def game_params
    params.expect(game: [:cols, :rows, :color, :handicap, :komi])
  end

  def find_or_create_session_player
    if session[:player_id]
      Player.find(session[:player_id])
    end
  end
end
