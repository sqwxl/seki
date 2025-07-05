class GameChannel < ApplicationCable::Channel
  def subscribed
    game = current_game
    @stream_id = "game_#{game.id}"
    stream_from @stream_id
  end

  def unsubscribed
    # Any cleanup needed when channel is unsubscribed
  end

  def chat(data)
    message = data["message"].to_s.strip
    return if message.blank?

    game = current_game
    player = current_player

    msg = Message.create!(game: game, player: player, text: message)

    ActionCable.server.broadcast(@stream_id, {
      kind: "chat",
      sender: msg.sender_label,
      text: msg.text
    })
  end

  def place_stone(data)
    col = data["col"]
    row = data["row"]
    with_game_and_player(:play) do |game, player, engine, stone|
      stage = engine.try_play(stone, [ col, row ])

      GameMove.create!(
        game: game,
        player: player,
        stone: stone,
        move_number: game.moves.count,
        kind: Go::MoveKind::PLAY,
        col: col,
        row: row
      )

      broadcast_state(stage, engine)
    end
  rescue => e
    Rails.logger.error e.message
    transmit({ kind: "error", message: e.message })
  end

  def request_undo
    with_game_and_player("request undo") do |game, player, engine, stone|
      raise "Cannot request undo at this time" unless game.can_request_undo?(player)

      last_move = game.moves.order(:move_number).last
      undo_request = UndoRequest.create!(
        game: game,
        requesting_player: player,
        target_move: last_move,
        status: UndoRequestStatus::PENDING
      )

      ActionCable.server.broadcast(@stream_id, {
        kind: "undo_request",
        request_id: undo_request.id,
        requesting_player: player.username || "Anonymous",
        move_number: last_move.move_number
      })
    end
  rescue => e
    Rails.logger.error e.message
    transmit({ kind: "error", message: e.message })
  end

  def respond_to_undo(data)
    response = data["response"]

    with_game_and_player("respond to undo") do |game, player, engine, stone|
      undo_request = game.undo_request
      raise "No pending undo request found" unless undo_request.present? && undo_request.pending?
      raise "You cannot respond to this undo request" unless undo_request.can_respond?(player)

      case response
      when "accept"
        undo_request.accept!(player)

        # Rebuild engine state after move removal
        updated_engine = Games::EngineBuilder.call(game)

        ActionCable.server.broadcast(@stream_id, {
          kind: "undo_accepted",
          request_id: undo_request.id,
          responding_player: player.username || "Anonymous",
          state: updated_engine.serialize,
          stage: game.stage
        })
      when "reject"
        undo_request.reject!(player)
        ActionCable.server.broadcast(@stream_id, {
          kind: "undo_rejected",
          request_id: undo_request.id,
          responding_player: player.username || "Anonymous"
        })
      else
        raise "Invalid response. Must be 'accept' or 'reject'"
      end
    end
  rescue => e
    Rails.logger.error e.message
    transmit({ kind: "error", message: e.message })
  end
  def pass
    with_game_and_player(:pass) do |game, player, engine, stone|
      stage = engine.try_pass(stone)

      GameMove.create!(
        game: game,
        player: player,
        stone: stone,
        kind: Go::MoveKind::PASS
      )

      if stage == Go::Status::Stage::TERRITORY_REVIEW
        TerritoryReview.create!(game: game)
      end

      broadcast_state(stage, engine)
    end
  end

  def resign
    game = current_game
    player = current_player
    engine = Games::EngineBuilder.call(game)

    raise "The game is over" if game.stage == Go::Status::Stage::DONE

    stage = engine.try_resign(game.player_stone(player))

    if stage == Go::Status::Stage::DONE
      game.update(ended_at: Time.current, result: engine.result)

      GameMove.create!(
        game: game,
        player: player,
        stone: game.player_stone(player),
        kind: Go::MoveKind::RESIGN
      )
    end

    broadcast_state(stage, engine)
  end


  def toggle_chain(data)
    game = current_game
    player = current_player

    raise "Not in territory counting phase" unless game.stage == Go::Status::Stage::TERRITORY_REVIEW

    only_players_can("count territory", game, player)

    # TODO update dead_stones
  end

  def territory_accept
    game = current_game
    player = current_player

    raise "Not in territory counting phase" unless game.stage == Go::Status::Stage::TERRITORY_REVIEW

    only_players_can("accept territory", game, player)

    # TODO update territory_review -> game
  end



  private

  def current_player
    connection.current_player
  end

  def current_game
    Game.find(params[:id])
  end

  def with_game_and_player(action)
    Game.transaction do
      game = current_game
      player = current_player

      only_players_can(action, game, player)

      game.lock!
      engine = Games::EngineBuilder.call(game)
      stone = game.player_stone(player)

      yield(game, player, engine, stone)
    end
  end

  def only_players_can(action, game, player)
    raise "Only players can #{action}" unless game.players.include?(player)
  end

  def broadcast_state(stage, engine)
    game = current_game
    game_state = Games::StateSerializer.call(game, engine)
    
    ActionCable.server.broadcast(@stream_id, {
      kind: "state",
      **game_state
    })
  end
end
