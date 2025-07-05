require "rails_helper"

RSpec.describe Go::Engine do
  let(:engine) { Go::Engine.new(cols: 4, rows: 4) }

  describe "initialization" do
    it "creates engine with square board" do
      expect(engine.cols).to eq(4)
      expect(engine.rows).to eq(4)
      expect(engine.board.length).to eq(4)
      expect(engine.board.first.length).to eq(4)
    end

    it "creates engine with rectangular board" do
      engine = Go::Engine.new(cols: 5, rows: 3)
      expect(engine.rows).to eq(3)
      expect(engine.cols).to eq(5)
      expect(engine.board.length).to eq(3)
      expect(engine.board.first.length).to eq(5)
    end

    it "defaults rows to cols when not specified" do
      engine = Go::Engine.new(cols: 6)
      expect(engine.rows).to eq(6)
      expect(engine.cols).to eq(6)
    end

    it "starts with empty board" do
      expect(engine.board.flatten).to all(eq(Go::Stone::EMPTY))
    end

    it "tracks captures starting at zero" do
      expect(engine.captures[Go::Stone::BLACK]).to eq(0)
      expect(engine.captures[Go::Stone::WHITE]).to eq(0)
    end

    it "initializes with moves if provided" do
      moves = [
        Go::Move.new(:play, Go::Stone::BLACK, [ 0, 0 ]),
        Go::Move.new(:play, Go::Stone::WHITE, [ 1, 0 ])
      ]
      engine = Go::Engine.new(cols: 4, moves: moves)
      expect(engine.stone_at([ 0, 0 ])).to eq(Go::Stone::BLACK)
      expect(engine.stone_at([ 1, 0 ])).to eq(Go::Stone::WHITE)
    end
  end

  describe "turn management" do
    it "starts with black to play" do
      expect(engine.current_turn_stone).to eq(Go::Stone::BLACK)
    end

    it "alternates turns after moves" do
      engine.try_play(Go::Stone::BLACK, [ 0, 0 ])
      expect(engine.current_turn_stone).to eq(Go::Stone::WHITE)

      engine.try_play(Go::Stone::WHITE, [ 1, 0 ])
      expect(engine.current_turn_stone).to eq(Go::Stone::BLACK)
    end

    it "maintains turn after pass" do
      engine.try_play(Go::Stone::BLACK, [ 0, 0 ])
      engine.try_pass(Go::Stone::WHITE)
      expect(engine.current_turn_stone).to eq(Go::Stone::BLACK)
    end

    it "prevents playing out of turn" do
      expect {
        engine.try_play(Go::Stone::WHITE, [ 0, 0 ])
      }.to raise_error(Go::Error::OutOfTurn)
    end

    it "prevents passing out of turn" do
      expect {
        engine.try_pass(Go::Stone::WHITE)
      }.to raise_error(Go::Error::OutOfTurn)
    end
  end

  describe "game stages" do
    it "starts unstarted" do
      expect(engine.stage).to eq(Go::Status::Stage::UNSTARTED)
    end

    it "moves to play stage after first move" do
      engine.try_play(Go::Stone::BLACK, [ 0, 0 ])
      expect(engine.stage).to eq(Go::Status::Stage::PLAY)
    end

    it "stays in play stage after single pass" do
      engine.try_play(Go::Stone::BLACK, [ 0, 0 ])
      engine.try_pass(Go::Stone::WHITE)
      expect(engine.stage).to eq(Go::Status::Stage::PLAY)
    end

    it "moves to territory review after two consecutive passes" do
      engine.try_play(Go::Stone::BLACK, [ 0, 0 ])
      engine.try_pass(Go::Stone::WHITE)
      engine.try_pass(Go::Stone::BLACK)
      expect(engine.stage).to eq(Go::Status::Stage::TERRITORY_REVIEW)
    end

    it "moves to finished after resignation" do
      engine.try_play(Go::Stone::BLACK, [ 0, 0 ])
      engine.try_resign(Go::Stone::WHITE)
      expect(engine.stage).to eq(Go::Status::Stage::DONE)
    end

    it "returns to play stage if move made after pass" do
      engine.try_play(Go::Stone::BLACK, [ 0, 0 ])
      engine.try_pass(Go::Stone::WHITE)
      engine.try_play(Go::Stone::BLACK, [ 1, 0 ])
      expect(engine.stage).to eq(Go::Status::Stage::PLAY)
    end
  end

  describe "move validation" do
    it "validates legal moves" do
      expect(engine.is_legal?([ 0, 0 ])).to be true
      expect(engine.is_legal?([ 3, 3 ])).to be true
    end

    it "rejects moves off board" do
      expect(engine.is_legal?([ -1, 0 ])).to be false
      expect(engine.is_legal?([ 4, 0 ])).to be false
      expect(engine.is_legal?([ 0, -1 ])).to be false
      expect(engine.is_legal?([ 0, 4 ])).to be false
    end

    it "rejects moves on occupied points" do
      engine.try_play(Go::Stone::BLACK, [ 0, 0 ])
      engine.try_play(Go::Stone::WHITE, [ 1, 0 ])
      expect(engine.is_legal?([ 0, 0 ])).to be false
      expect(engine.is_legal?([ 1, 0 ])).to be false
    end

    it "rejects suicidal moves" do
      # Create a position where [1,1] would be suicide for white
      layout = [
        "+B++",
        "B+B+", 
        "+B++",
        "++++"
      ]
      engine = engine_from_layout(layout)

      expect(engine.is_legal?([ 1, 1 ], Go::Stone::WHITE)).to be false
    end
  end

  describe "captures tracking" do
    it "tracks captures by color" do
      # Set up a capture scenario
      engine.try_play(Go::Stone::BLACK, [ 0, 1 ])  # Black
      engine.try_play(Go::Stone::WHITE, [ 0, 0 ])  # White
      engine.try_play(Go::Stone::BLACK, [ 1, 0 ])  # Black captures white

      expect(engine.captures[Go::Stone::BLACK]).to eq(1)
      expect(engine.captures[Go::Stone::WHITE]).to eq(0)
    end

    it "provides stone-specific capture counts" do
      engine.try_play(Go::Stone::BLACK, [ 0, 1 ])
      engine.try_play(Go::Stone::WHITE, [ 0, 0 ])
      engine.try_play(Go::Stone::BLACK, [ 1, 0 ])

      expect(engine.stone_captures(Go::Stone::BLACK)).to eq(1)
      expect(engine.stone_captures(:black)).to eq(1)
      expect(engine.stone_captures(Go::Stone::WHITE)).to eq(0)
    end

    it "rejects capture count for empty stone" do
      expect {
        engine.stone_captures(Go::Stone::EMPTY)
      }.to raise_error(ArgumentError, /Invalid stone, EMPTY/)
    end
  end

  describe "game state access" do
    it "provides access to ko state" do
      expect(engine.ko).to eq(Go::NO_KO)
    end

    it "provides access to board matrix" do
      expect(engine.board).to eq(engine.goban.mtrx)
    end

    it "provides stone at specific position" do
      engine.try_play(Go::Stone::BLACK, [ 2, 2 ])
      expect(engine.stone_at([ 2, 2 ])).to eq(Go::Stone::BLACK)
      expect(engine.stone_at([ 0, 0 ])).to eq(Go::Stone::EMPTY)
    end
  end

end
