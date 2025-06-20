class GameChannel < ApplicationCable::Channel
  def subscribed
    @game = Game.find(params[:id])
    @stream_id = "game_#{@game.id}"
    stream_from @stream_id
  end

  def unsubscribed
    # Any cleanup needed when channel is unsubscribed
  end

  def place_stone(data)
    col = data["col"]
    row = data["row"]

    @game = Game.find(params[:id])
    session_id = connection.session_id

    player = Player.find_by(session_token: session_id)

    raise "Only players can make a move" unless player&.id == @game.player_black_id || player&.id == @game.player_white_id

    player_stone = (player.id == @game.player_black_id) ? Go::Stone::BLACK : Go::Stone::WHITE

    engine = @game.engine
    current_stone = engine.current_turn_stone

    raise "Out of turn, it's #{current_stone}'s turn" if player_stone != current_stone

    if engine.try_play([col, row])
      Move.create!(game: @game, player: player, col: col, row: row, move_number: @game.engine.moves.count, kind: Go::MoveKind::PLAY)
    end

    ActionCable.server.broadcast(@stream_id, {
      kind: "move",
      payload: JSON.parse(engine.serialize) # TODO: it's silly to parse this since it's going to get encoded straight away again
    })
  end

  def speak(data)
    message = data["message"].to_s.strip
    return if message.blank?

    sender = if connection.session_id == @game.player_1_id
      "Black"
    else
      (connection.session_id == @game.player_2_id) ? "White" : "Spectator"
    end

    ActionCable.server.broadcast(@stream_id, {
      kind: "chat",
      sender: sender,
      text: message
    })
  end
end
