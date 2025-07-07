require "rails_helper"

RSpec.describe Go::EngineSerializer do
  let(:engine) { Go::Engine.new(cols: 4, rows: 4) }

  describe ".serialize" do
    it "serializes empty engine state" do
      result = described_class.serialize(engine)

      expect(result).to be_a(Hash)
      expect(result["ko"]).to have_key(:point)
      expect(result["ko"]).to have_key(:stone)
      expect(result["ko"][:point]).to eq([-1, -1])
      expect(result["ko"][:stone]).to eq(Go::Stone::EMPTY)
      expect(result["captures"]).to eq({
        Go::Stone::BLACK => 0,
        Go::Stone::WHITE => 0
      })
      expect(result["board"]).to be_a(Array)
      expect(result["board"].length).to eq(4)
      expect(result["board"].first.length).to eq(4)
      expect(result["board"].flatten).to all(eq(Go::Stone::EMPTY))
      expect(result["stage"]).to eq(Go::Status::Stage::UNSTARTED)
    end

    it "serializes engine with moves and captures" do
      engine.try_play(Go::Stone::BLACK, [0, 1])
      engine.try_play(Go::Stone::WHITE, [0, 0])
      engine.try_play(Go::Stone::BLACK, [1, 0])

      result = described_class.serialize(engine)

      expect(result["captures"]).to eq({
        Go::Stone::BLACK => 1,
        Go::Stone::WHITE => 0
      })
      expect(result["board"][0][1]).to eq(Go::Stone::BLACK)
      expect(result["board"][1][0]).to eq(Go::Stone::BLACK)
      expect(result["board"][0][0]).to eq(Go::Stone::EMPTY)
      expect(result["stage"]).to eq(Go::Status::Stage::PLAY)
    end

    it "serializes engine with ko state" do
      # Create a ko situation using the layout helper
      layout = [
        "+BW+",
        "BW+W",
        "+BW+",
        "++++"
      ]

      # Start with the pre-ko position
      engine = engine_from_layout(layout)

      # Now play black at [2,1] to capture white at [1,1], creating ko
      engine.try_play(Go::Stone::BLACK, [2, 1])

      result = described_class.serialize(engine)

      expect(result["ko"][:point]).to_not eq([-1, -1])
      expect(result["ko"][:stone]).to eq(Go::Stone::WHITE)
      expect(result["ko"][:point]).to eq([1, 1])
    end
  end

  describe ".deserialize" do
    it "deserializes empty engine state" do
      original_state = described_class.serialize(engine)

      restored_engine = described_class.deserialize(
        cols: 4,
        rows: 4,
        moves: [],
        state: original_state
      )

      expect(restored_engine.cols).to eq(4)
      expect(restored_engine.rows).to eq(4)
      expect(restored_engine.board).to eq(engine.board)
      expect(restored_engine.captures).to eq(engine.captures)
      expect(restored_engine.ko).to eq(engine.ko)
      expect(restored_engine.stage).to eq(engine.stage)
    end

    it "deserializes engine with moves and captures" do
      engine.try_play(Go::Stone::BLACK, [0, 1])
      engine.try_play(Go::Stone::WHITE, [0, 0])
      engine.try_play(Go::Stone::BLACK, [1, 0])

      original_state = described_class.serialize(engine)
      moves = engine.moves.dup

      restored_engine = described_class.deserialize(
        cols: 4,
        rows: 4,
        moves: moves,
        state: original_state
      )

      expect(restored_engine.board).to eq(engine.board)
      expect(restored_engine.captures).to eq(engine.captures)
      expect(restored_engine.ko).to eq(engine.ko)
      expect(restored_engine.moves).to eq(moves)
      expect(restored_engine.stage).to eq(engine.stage)
    end

    it "deserializes engine with ko state" do
      # Create the same ko situation using layout helper
      layout = [
        "+BW+",
        "BW+W",
        "+BW+",
        "++++"
      ]

      # Start with the pre-ko position
      engine = engine_from_layout(layout)

      # Now play black at [2,1] to capture white at [1,1], creating ko
      engine.try_play(Go::Stone::BLACK, [2, 1])

      original_state = described_class.serialize(engine)
      moves = engine.moves.dup

      restored_engine = described_class.deserialize(
        cols: 4,
        rows: 4,
        moves: moves,
        state: original_state
      )

      expect(restored_engine.ko).to eq(engine.ko)
      expect(restored_engine.ko.point).to eq([1, 1])
      expect(restored_engine.ko.stone).to eq(Go::Stone::WHITE)
      expect(restored_engine.board).to eq(engine.board)
      expect(restored_engine.captures).to eq(engine.captures)
    end

    it "handles rectangular boards" do
      rect_engine = Go::Engine.new(cols: 5, rows: 3)
      rect_engine.try_play(Go::Stone::BLACK, [2, 1])

      original_state = described_class.serialize(rect_engine)
      moves = rect_engine.moves.dup

      restored_engine = described_class.deserialize(
        cols: 5,
        rows: 3,
        moves: moves,
        state: original_state
      )

      expect(restored_engine.cols).to eq(5)
      expect(restored_engine.rows).to eq(3)
      expect(restored_engine.board).to eq(rect_engine.board)
      expect(restored_engine.stone_at([2, 1])).to eq(Go::Stone::BLACK)
    end

    it "handles serialized state consistently" do
      engine.try_play(Go::Stone::BLACK, [0, 0])
      original_state = described_class.serialize(engine)

      restored_engine = described_class.deserialize(
        cols: 4,
        rows: 4,
        moves: engine.moves.dup,
        state: original_state
      )

      expect(restored_engine.board).to eq(engine.board)
      expect(restored_engine.captures).to eq(engine.captures)
      expect(restored_engine.stone_at([0, 0])).to eq(Go::Stone::BLACK)
    end
  end

  describe "round-trip serialization" do
    it "preserves engine state through serialize/deserialize cycle" do
      engine.try_play(Go::Stone::BLACK, [0, 0])
      engine.try_play(Go::Stone::WHITE, [1, 1])
      engine.try_play(Go::Stone::BLACK, [2, 2])
      engine.try_pass(Go::Stone::WHITE)

      serialized = described_class.serialize(engine)
      restored = described_class.deserialize(
        cols: engine.cols,
        rows: engine.rows,
        moves: engine.moves.dup,
        state: serialized
      )

      expect(restored.board).to eq(engine.board)
      expect(restored.captures).to eq(engine.captures)
      expect(restored.ko).to eq(engine.ko)
      expect(restored.stage).to eq(engine.stage)
      expect(restored.moves).to eq(engine.moves)
    end

    it "handles complex game states with captures" do
      engine.try_play(Go::Stone::BLACK, [0, 1])
      engine.try_play(Go::Stone::WHITE, [0, 0])
      engine.try_play(Go::Stone::BLACK, [1, 0])
      engine.try_play(Go::Stone::WHITE, [2, 0])
      engine.try_play(Go::Stone::BLACK, [3, 0])
      engine.try_play(Go::Stone::WHITE, [3, 1])

      serialized = described_class.serialize(engine)
      restored = described_class.deserialize(
        cols: engine.cols,
        rows: engine.rows,
        moves: engine.moves.dup,
        state: serialized
      )

      expect(restored.board).to eq(engine.board)
      expect(restored.captures).to eq(engine.captures)
      expect(restored.ko).to eq(engine.ko)
      expect(restored.stone_captures(Go::Stone::BLACK)).to eq(engine.stone_captures(Go::Stone::BLACK))
      expect(restored.stone_captures(Go::Stone::WHITE)).to eq(engine.stone_captures(Go::Stone::WHITE))
    end
  end
end
