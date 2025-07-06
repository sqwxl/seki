require "rails_helper"

RSpec.describe Games::EngineBuilder do
  let(:creator) { Player.create!(email: "creator@example.com") }
  let(:black_player) { Player.create!(email: "black@example.com") }
  let(:white_player) { Player.create!(email: "white@example.com") }
  let(:game) do
    Game.create!(
      creator: creator,
      black: black_player,
      white: white_player,
      cols: 19,
      rows: 19,
      komi: 6.5,
      handicap: 2
    )
  end
  let(:move1) do
    GameMove.create!(
      game: game,
      player: black_player,
      kind: "play",
      stone: "black",
      col: 3,
      row: 3
    )
  end
  let(:move2) do
    GameMove.create!(
      game: game,
      player: white_player,
      kind: "play",
      stone: "white",
      col: 15,
      row: 15
    )
  end

  describe ".call" do
    context "when no cache exists" do
      it "builds engine from scratch" do
        expect(described_class).to receive(:build).with(game).and_call_original
        expect(described_class).to receive(:cache_engine_state).with(game, kind_of(Go::Engine), 0)

        result = described_class.call(game)
        expect(result).to be_a(Go::Engine)
      end

      it "caches the engine state after building" do
        described_class.call(game)
        expect(game.reload.cached_engine_state).to include("move_count" => 0)
      end
    end

    context "when cache exists and move count matches" do
      before do
        move1
        described_class.call(game)
        @cached_state = game.reload.cached_engine_state
      end

      it "uses cached state instead of rebuilding" do
        expect(described_class).to receive(:build_from_cache).with(game).and_call_original
        expect(described_class).not_to receive(:build)

        described_class.call(game)
      end

      it "returns engine with correct state from cache" do
        result = described_class.call(game)
        expect(result).to be_a(Go::Engine)
        expect(result.moves.length).to eq(1)
      end

      it "does not update cache when using cached state" do
        original_cache = game.cached_engine_state.dup
        described_class.call(game)
        expect(game.reload.cached_engine_state).to eq(original_cache)
      end
    end

    context "when cache exists but move count differs" do
      before do
        move1
        described_class.call(game)
        move2
      end

      it "rebuilds engine from scratch when move count increases" do
        expect(described_class).to receive(:build).with(game).and_call_original
        expect(described_class).not_to receive(:build_from_cache)

        described_class.call(game)
      end

      it "updates cache with new move count" do
        described_class.call(game)
        expect(game.reload.cached_engine_state["move_count"]).to eq(2)
      end
    end

    context "when cached move count is 0 and current move count is 0" do
      before do
        game.update!(cached_engine_state: { "move_count" => 0, "some_state" => "data" })
      end

      it "rebuilds from scratch (does not use cache for 0 moves)" do
        expect(described_class).to receive(:build).with(game).and_call_original
        expect(described_class).not_to receive(:build_from_cache)

        described_class.call(game)
      end
    end

    context "when cached_engine_state is nil" do
      before do
        game.update!(cached_engine_state: nil)
      end

      it "builds fresh and caches the result" do
        expect(described_class).to receive(:build).with(game).and_call_original
        expect(described_class).to receive(:cache_engine_state)

        result = described_class.call(game)
        expect(result).to be_a(Go::Engine)
      end
    end

    context "with different board sizes" do
      let(:small_game) do
        Game.create!(
          creator: creator,
          black: black_player,
          white: white_player,
          cols: 9,
          rows: 9,
          komi: 6.5,
          handicap: 2
        )
      end

      it "handles different board dimensions correctly" do
        result = described_class.call(small_game)
        expect(result).to be_a(Go::Engine)
        expect(small_game.reload.cached_engine_state["move_count"]).to eq(0)
      end
    end

    context "with non-play moves" do
      let(:pass_move) do
        GameMove.create!(
          game: game,
          player: black_player,
          kind: "pass",
          stone: "black",
          col: nil,
          row: nil
        )
      end

      it "handles pass moves correctly" do
        pass_move
        result = described_class.call(game)
        expect(result).to be_a(Go::Engine)
        expect(result.moves.length).to eq(1)
        expect(game.reload.cached_engine_state["move_count"]).to eq(1)
      end
    end

    context "with corrupted cache (wrong move count)" do
      before do
        move1
        # Simulate cache corruption by setting wrong move count
        game.update!(cached_engine_state: { "move_count" => 5, "corrupted" => "data" })
      end

      it "rebuilds fresh when cache move count is incorrect" do
        expect(described_class).to receive(:build).with(game).and_call_original
        expect(described_class).not_to receive(:build_from_cache)

        result = described_class.call(game)
        expect(result).to be_a(Go::Engine)
        expect(game.reload.cached_engine_state["move_count"]).to eq(1)
      end
    end
  end

  describe ".build_from_cache" do
    let(:cached_state) do
      {
        "move_count" => 2,
        "board_state" => "serialized_data",
        "current_player" => "white"
      }
    end

    before do
      move1
      move2
      game.update!(cached_engine_state: cached_state)
    end

    it "deserializes engine with game moves and cached state" do
      allow(Go::Engine).to receive(:deserialize)

      described_class.send(:build_from_cache, game)

      expect(Go::Engine).to have_received(:deserialize) do |args|
        expect(args[:cols]).to eq(19)
        expect(args[:rows]).to eq(19)
        expect(args[:state]).to eq(cached_state)
        expect(args[:moves]).to all(be_a(Go::Move))
        expect(args[:moves].length).to eq(2)
      end
    end

    it "processes moves in correct order" do
      allow(Go::Engine).to receive(:deserialize)

      described_class.send(:build_from_cache, game)

      expect(Go::Engine).to have_received(:deserialize) do |args|
        moves = args[:moves]
        expect(moves[0].point).to eq([ 3, 3 ])   # First move
        expect(moves[1].point).to eq([ 15, 15 ]) # Second move
      end
    end
  end

  describe ".build" do
    before do
      move1
      move2
    end

    it "creates new engine with game parameters and moves" do
      allow(Go::Engine).to receive(:new)

      described_class.send(:build, game)

      expect(Go::Engine).to have_received(:new) do |args|
        expect(args[:cols]).to eq(19)
        expect(args[:rows]).to eq(19)
        expect(args[:moves]).to all(be_a(Go::Move))
        expect(args[:moves].length).to eq(2)
      end
    end

    it "processes moves in correct order" do
      allow(Go::Engine).to receive(:new)

      described_class.send(:build, game)

      expect(Go::Engine).to have_received(:new) do |args|
        moves = args[:moves]
        expect(moves[0].point).to eq([ 3, 3 ])   # First move
        expect(moves[1].point).to eq([ 15, 15 ]) # Second move
      end
    end
  end

  describe ".cache_engine_state" do
    let(:engine) { double("engine") }
    let(:serialized_state) { { "board" => "state", "player" => "black" } }

    before do
      allow(engine).to receive(:serialize).and_return(serialized_state)
    end

    it "merges engine state with move count and updates game record" do
      described_class.send(:cache_engine_state, game, engine, 3)

      expected_cache = serialized_state.merge("move_count" => 3)
      expect(game.reload.cached_engine_state).to eq(expected_cache)
    end
  end

  context "integration tests" do
    it "maintains cache consistency across multiple calls" do
      # First call - no moves
      described_class.call(game)
      cache1 = game.reload.cached_engine_state

      # Add a move
      move1
      result2 = described_class.call(game)
      cache2 = game.reload.cached_engine_state

      # Call again with same moves
      result3 = described_class.call(game)
      cache3 = game.reload.cached_engine_state

      expect(cache1["move_count"]).to eq(0)
      expect(cache2["move_count"]).to eq(1)
      expect(cache3).to eq(cache2) # Should be unchanged

      expect(result2.moves.length).to eq(1)
      expect(result3.moves.length).to eq(1)
    end

    it "handles cache invalidation when moves are removed" do
      move1
      move2
      described_class.call(game)

      # Remove a move (simulating undo)
      game.moves.last.destroy!
      game.reload # Reload to reflect the destroyed move

      result = described_class.call(game)
      expect(game.reload.cached_engine_state["move_count"]).to eq(1)
      expect(result.moves.length).to eq(1)
    end
  end
end

