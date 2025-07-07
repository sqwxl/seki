class GameChannel < ApplicationCable::Channel
  def subscribed
    game = current_game
    player = current_player
    @stream_id = "game_#{game.id}"
    @player_stream_id = "game_#{game.id}_player_#{player.id}"

    stream_from @stream_id
    stream_from @player_stream_id

    # Send current game state to the newly connected client
    engine = Games::EngineBuilder.call(game)
    game_state = Games::StateSerializer.call(game, engine)

    transmit({
      kind: "state",
      stage: game_state[:stage],
      state: game_state[:state],
      negotiations: game_state[:negotiations],
      current_turn_stone: game_state[:current_turn_stone]
    })

    # If there's already a pending undo request, send the appropriate targeted message
    if game.has_pending_undo_request?
      if game.undo_requesting_player == player
        # This player made the request, show waiting state
        transmit({
          kind: "undo_request_sent",
          stage: game_state[:stage],
          state: game_state[:state],
          current_turn_stone: game_state[:current_turn_stone],
          message: "Undo request sent. Waiting for opponent response..."
        })
      else
        # This player needs to respond, show response controls
        transmit({
          kind: "undo_response_needed",
          stage: game_state[:stage],
          state: game_state[:state],
          current_turn_stone: game_state[:current_turn_stone],
          requesting_player: game.undo_requesting_player.username || "Anonymous",
          message: "#{game.undo_requesting_player.username || "Opponent"} has requested to undo their last move"
        })
      end
    end
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
      stage = engine.try_play(stone, [col, row])

      game.create_move!(
        player: player,
        stone: stone,
        kind: Go::MoveKind::PLAY,
        col: col,
        row: row
      )

      broadcast_state(stage, engine)
    end
  rescue => e
    Rails.logger.error e.message
    transmit({kind: "error", message: e.message})
  end

  def request_undo
    with_game_and_player("request undo") do |game, player, engine, stone|
      game.request_undo!(player)

      # Send targeted messages to each player
      send_undo_request_states(game, player, engine)
    end
  rescue => e
    Rails.logger.error e.message
    transmit({kind: "error", message: e.message})
  end

  def respond_to_undo(data)
    response = data["response"]&.strip&.downcase

    # Validate input early
    unless %w[accept reject].include?(response)
      transmit({kind: "error", message: "Invalid response"})
      return
    end

    with_game_and_player("respond to undo") do |game, player, engine, stone|
      requesting_player = game.undo_requesting_player

      if response == "accept"
        game.accept_undo!(player)
        updated_engine = Games::EngineBuilder.call(game)
        send_undo_result_messages(game, "accepted", player, requesting_player, updated_engine)
      else
        game.reject_undo!(player)
        send_undo_result_messages(game, "rejected", player, requesting_player, engine)
      end
    end
  rescue => e
    Rails.logger.error "Undo response error: #{e.message}"
    transmit({kind: "error", message: "Unable to process undo response"})
  end

  def pass
    with_game_and_player(:pass) do |game, player, engine, stone|
      stage = engine.try_pass(stone)

      game.create_move!(
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

      game.create_move!(
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
      stage: game_state[:stage],
      state: game_state[:state],
      negotiations: game_state[:negotiations],
      current_turn_stone: game_state[:current_turn_stone]
    })
  end

  def send_undo_request_states(game, requesting_player, engine)
    base_state = Games::StateSerializer.call(game, engine)

    # Send "waiting" state to requesting player
    ActionCable.server.broadcast("game_#{game.id}_player_#{requesting_player.id}", {
      kind: "undo_request_sent",
      stage: base_state[:stage],
      state: base_state[:state],
      current_turn_stone: base_state[:current_turn_stone],
      message: "Undo request sent. Waiting for opponent response..."
    })

    # Send "response needed" state to opponent
    opponent = find_opponent(game, requesting_player)
    if opponent
      ActionCable.server.broadcast("game_#{game.id}_player_#{opponent.id}", {
        kind: "undo_response_needed",
        stage: base_state[:stage],
        state: base_state[:state],
        current_turn_stone: base_state[:current_turn_stone],
        requesting_player: safe_username(requesting_player),
        message: "#{safe_username(requesting_player)} has requested to undo their last move"
      })
    end
  end

  def send_undo_result_messages(game, result, responding_player, requesting_player, engine)
    base_state = Games::StateSerializer.call(game, engine)
    result_message = "#{safe_username(responding_player)} #{result} the undo request"
    result_message += ". Move has been undone." if result == "accepted"

    # Send result to both players
    [requesting_player, responding_player].each do |player|
      ActionCable.server.broadcast("game_#{game.id}_player_#{player.id}", {
        kind: "undo_#{result}",
        stage: base_state[:stage],
        state: base_state[:state],
        current_turn_stone: base_state[:current_turn_stone],
        responding_player: safe_username(responding_player),
        message: result_message
      })
    end
  end

  def find_opponent(game, player)
    game.players.find { |p| p != player }
  end

  def safe_username(player)
    player&.username&.present? ? player.username : "Opponent"
  end
end
