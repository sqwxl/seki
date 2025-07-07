require "rails_helper"

RSpec.describe Go::Move do
  describe "initialization" do
    it "creates play move with point" do
      move = Go::Move.new(:play, Go::Stone::BLACK, [0, 0])
      expect(move.kind).to eq(:play)
      expect(move.stone).to eq(Go::Stone::BLACK)
      expect(move.point).to eq([0, 0])
    end

    it "creates pass move without point" do
      move = Go::Move.new(:pass, Go::Stone::WHITE, nil)
      expect(move.kind).to eq(:pass)
      expect(move.stone).to eq(Go::Stone::WHITE)
      expect(move.point).to be_nil
    end

    it "creates resign move without point" do
      move = Go::Move.new(:resign, Go::Stone::BLACK, nil)
      expect(move.kind).to eq(:resign)
      expect(move.stone).to eq(Go::Stone::BLACK)
      expect(move.point).to be_nil
    end

    it "accepts string move kinds and converts to symbols" do
      move = Go::Move.new("play", Go::Stone::BLACK, [1, 1])
      expect(move.kind).to eq(:play)

      move = Go::Move.new("pass", Go::Stone::WHITE, nil)
      expect(move.kind).to eq(:pass)

      move = Go::Move.new("resign", Go::Stone::BLACK, nil)
      expect(move.kind).to eq(:resign)
    end

    it "rejects invalid move kinds" do
      expect {
        Go::Move.new(:invalid, Go::Stone::BLACK, nil)
      }.to raise_error(ArgumentError, /invalid move kind: invalid/)

      expect {
        Go::Move.new("unknown", Go::Stone::WHITE, nil)
      }.to raise_error(ArgumentError, /invalid move kind: unknown/)
    end

    it "requires point for play moves" do
      expect {
        Go::Move.new(:play, Go::Stone::BLACK, nil)
      }.to raise_error(ArgumentError, /:point cannot be nil/)
    end

    it "allows nil point for non-play moves" do
      expect {
        Go::Move.new(:pass, Go::Stone::WHITE, nil)
      }.not_to raise_error

      expect {
        Go::Move.new(:resign, Go::Stone::BLACK, nil)
      }.not_to raise_error
    end
  end

  describe "move type queries" do
    it "identifies play moves correctly" do
      move = Go::Move.new(:play, Go::Stone::BLACK, [0, 0])
      expect(move.play?).to be true
      expect(move.pass?).to be false
      expect(move.resign?).to be false
    end

    it "identifies pass moves correctly" do
      move = Go::Move.new(:pass, Go::Stone::WHITE, nil)
      expect(move.play?).to be false
      expect(move.pass?).to be true
      expect(move.resign?).to be false
    end

    it "identifies resign moves correctly" do
      move = Go::Move.new(:resign, Go::Stone::BLACK, nil)
      expect(move.play?).to be false
      expect(move.pass?).to be false
      expect(move.resign?).to be true
    end
  end

  describe "struct behavior" do
    it "allows accessing fields by name" do
      move = Go::Move.new(:play, Go::Stone::BLACK, [2, 3])
      expect(move[:kind]).to eq(:play)
      expect(move[:stone]).to eq(Go::Stone::BLACK)
      expect(move[:point]).to eq([2, 3])
    end

    it "allows accessing fields by index" do
      move = Go::Move.new(:pass, Go::Stone::WHITE, nil)
      expect(move[0]).to eq(:pass)
      expect(move[1]).to eq(Go::Stone::WHITE)
      expect(move[2]).to be_nil
    end

    it "supports equality comparison" do
      move1 = Go::Move.new(:play, Go::Stone::BLACK, [1, 1])
      move2 = Go::Move.new(:play, Go::Stone::BLACK, [1, 1])
      move3 = Go::Move.new(:play, Go::Stone::WHITE, [1, 1])

      expect(move1).to eq(move2)
      expect(move1).not_to eq(move3)
    end

    it "supports to_a conversion" do
      move = Go::Move.new(:resign, Go::Stone::BLACK, nil)
      expect(move.to_a).to eq([:resign, Go::Stone::BLACK, nil])
    end
  end

  describe "integration with MoveKind constants" do
    it "accepts all valid move kinds" do
      expect {
        Go::Move.new(Go::MoveKind::PLAY, Go::Stone::BLACK, [0, 0])
      }.not_to raise_error

      expect {
        Go::Move.new(Go::MoveKind::PASS, Go::Stone::WHITE, nil)
      }.not_to raise_error

      expect {
        Go::Move.new(Go::MoveKind::RESIGN, Go::Stone::BLACK, nil)
      }.not_to raise_error
    end
  end
end
