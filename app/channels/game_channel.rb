class GameChannel < ApplicationCable::Channel
  def subscribed
    game = current_game
    @stream_id = "game_#{game.id}"
    stream_from @stream_id
  end

  def unsubscribed
    # Any cleanup needed when channel is unsubscribed
  end

  def place_stone(data)
    col = data["col"]
    row = data["row"]

    with_game_and_player(:play) do |game, player, engine|
      stage = engine.try_play(game.player_stone(player), [col, row])
      Move.create!(
        game: game,
        player: player,
        stone: game.player_stone(player),
        move_number: game.moves.count,
        kind: Go::MoveKind::PLAY,
        col: col,
        row: row
      )
      broadcast_state(stage, engine)
    end
  end

  def pass
    with_game_and_player(:pass) do |game, player, engine|
      stage = engine.try_pass(game.player_stone(player))

      Move.create!(
        game: game,
        player: player,
        stone: game.player_stone(player),
        kind: Go::MoveKind::PASS
      )

      if stage == Go::Stage::TERRITORY_REVIEW
        TerritoryReview.create!(game: game)
      end

      broadcast_state(stage, engine)
    end
  end

  def resign
    game = current_game
    player = current_player
    engine = game.engine

    raise "The game is over" if game.stage == Go::Stage::DONE

    stage = engine.try_resign(game.player_stone(player))

    if stage == Go::Stage::DONE
      game.update(ended_at: Time.current, result: engine.result)
      Move.create!(
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

    raise "Not in territory counting phase" unless game.stage == Go::Stage::TERRITORY_COUNT

    only_players_can("count territory", game, player)

    # TODO update dead_stones
  end

  def territory_accept
    game = current_game
    player = current_player

    raise "Not in territory counting phase" unless game.stage == Go::Stage::TERRITORY_COUNT

    only_players_can("accept territory", game, player)

    # TODO update territory_review -> game
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

  private

  def current_player
    connection.current_player
  end

  def current_game
    @game ||= Game.find(params[:id])
  end

  def with_game_and_player(action)
    game = current_game
    player = current_player

    raise "The game is already over" if game.stage == Go::Stage::DONE

    only_players_can(action, game, player)

    player_stone = (player == game.player_black) ? Go::Stone::BLACK : Go::Stone::WHITE
    engine = game.engine
    current_stone = engine.current_turn_stone

    raise "Out of turn, it's #{Go::Stone.to_s(current_stone)}'s turn" if player_stone != current_stone

    yield(game, player, engine)
  end

  def only_players_can(action, game, player)
    raise "Only players can #{action}" unless game.players.include?(player)
  end

  def broadcast_state(stage, engine)
    ActionCable.server.broadcast(@stream_id, {
      kind: "state",
      stage: stage,
      state: JSON.parse(engine.serialize) # TODO: it's silly to parse this since it's going to get encoded straight away again
    })
  end
end
