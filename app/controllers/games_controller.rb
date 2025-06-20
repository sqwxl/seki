class GamesController < ApplicationController
  def index
  end

  def new
    @game = Game.new
  end

  def create
    @game = Game.create(game_params)

    current = current_player

    if params[:email].present? && current.email.blank?
      current.update(email: params[:email])
    end

    friend = Player.find_or_create_by(email: params[:invite_email]) if params[:invite_email].present?

    color = case params[:color]
    when "black" then "black"
    when "white" then "white"
    when "nigiri" then %w[black white].sample
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

    if @game.save
      redirect_to @game
    else
      flash.now.alert = @game.errors.full_messages.to_sentence
      render :new, status: :unprocessable_entity
    end
  end

  def show
    @game = Game.find(params[:id])

    unless @game.players.any? { |p| p == current_player }
      if @game.player_black.nil?
        @game.update(player_black: current_player)
      elsif @game.player_white.nil?
        @game.update(player_white: current_player)
      end
    end

    moves = @game.moves.map do |move|
      Go::Move.new(move.kind.to_sym, [move.col, move.row])
    end

    @engine = Go::Engine.new(cols: @game.cols, rows: @game.rows, moves: moves)
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
