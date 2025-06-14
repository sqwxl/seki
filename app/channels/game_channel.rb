class GameChannel < ApplicationCable::Channel
  def subscribed
    @game = Game.find(params[:id])
    @stream_id = "game_#{@game.id}"
    stream_from @stream_id
  end

  def unsubscribed
    # Any cleanup needed when channel is unsubscribed
  end

  def make_move(data)
    x = data["x"]
    y = data["y"]
    session_id = connection.session_id

    @game = Game.find(params[:id])
    color =
      if session_id == @game.player_1_id
        "black"
      elsif session_id == @game.player_2_id
        "white"
      else
        "spectator"
      end

    return if color == "spectator"

    move_number = @game.moves.count + 1

    move = @game.moves.create!(x: x, y: y, color: color, move_number: move_number)

    ActionCable.server.broadcast(@stream_id, {
      kind: "move",
      x: move.x,
      y: move.y,
      color: move.color,
      move_number: move.move_number
    })
  end

  def speak(data)
    message = data["message"].to_s.strip
    return if message.blank?

    sender = connection.session_id == @game.player_1_id ? "Black" :
            connection.session_id == @game.player_2_id ? "White" : "Spectator"

    ActionCable.server.broadcast(@stream_id, {
      kind: "chat",
      sender: sender,
      text: message
    })
  end
end
