require "rails_helper"

RSpec.describe Go::Goban do

  describe "initialization" do
    it "rejects malformed board" do
      layout = [
        "+",
        "++"
      ]
      expect {
        goban_from_layout(layout)
      }.to raise_error(ArgumentError)
    end

    it "creates empty board" do
      goban = Go::Goban.with_dimensions(cols: 4)
      expect(goban.empty?).to be true
    end

    it "creates board with specified dimensions" do
      goban = Go::Goban.with_dimensions(cols: 5, rows: 3)
      expect(goban.mtrx.length).to eq(3)
      expect(goban.mtrx.first.length).to eq(5)
    end
  end

  describe "move validation" do
    it "prevents overwrite moves" do
      goban = Go::Goban.with_dimensions(cols: 4)
      goban = goban.play([ 0, 0 ], Go::Stone::BLACK)
      expect {
        goban.play([ 0, 0 ], Go::Stone::WHITE)
      }.to raise_error(Go::Error::Overwrite)
    end

    it "prevents ko violation" do
      layout = [
        "+BW+",
        "BW+W",
        "+BW+",
        "++++"
      ]
      goban = goban_from_layout(layout)
      goban = goban.play([ 2, 1 ], Go::Stone::BLACK)
      expect {
        goban.play([ 1, 1 ], Go::Stone::WHITE)
      }.to raise_error(Go::Error::KoViolation)
    end

    it "prevents suicide" do
      layout = [
        "+B++",
        "B+++",
        "++++",
        "++++"
      ]
      goban = goban_from_layout(layout)
      expect {
        goban = goban.play([ 0, 0 ], Go::Stone::WHITE)
      }.to raise_error(Go::Error::Suicide)
    end
  end

  describe "captures" do
    it "captures single stone" do
      layout = [
        "+B++",
        "BWB+",
        "++++",
        "++++"
      ]
      goban = goban_from_layout(layout)
      goban = goban.play([ 1, 2 ], Go::Stone::BLACK)
      expect(goban.captures[Go::Stone::BLACK]).to eq(1)
    end

    it "captures stone chains" do
      layout = [
        "+BB+",
        "BWWB",
        "W+WB",
        "WWB+"
      ]
      goban = goban_from_layout(layout)
      goban = goban.play([ 1, 2 ], Go::Stone::BLACK)
      expect(goban.captures[Go::Stone::BLACK]).to eq(6)
    end
  end

  describe "board utilities" do
    let(:goban) { Go::Goban.with_dimensions(cols: 4, rows: 4) }

    it "checks if point is on board" do
      expect(goban.on_board?([ 0, 0 ])).to be true
      expect(goban.on_board?([ 3, 3 ])).to be true
      expect(goban.on_board?([ -1, 0 ])).to be false
      expect(goban.on_board?([ 4, 0 ])).to be false
      expect(goban.on_board?([ 0, 4 ])).to be false
    end

    it "gets stone at position" do
      goban = Go::Goban.with_dimensions(cols: 4, rows: 4)
      goban = goban.play([ 1, 1 ], Go::Stone::BLACK)
      expect(goban.stone_at([ 1, 1 ])).to eq(Go::Stone::BLACK)
      expect(goban.stone_at([ 0, 0 ])).to eq(Go::Stone::EMPTY)
      expect(goban.stone_at([ 5, 5 ])).to be_nil
    end

    it "captures single stone when completely surrounded" do
      goban = Go::Goban.with_dimensions(cols: 4, rows: 4)
      goban = goban.play([ 1, 1 ], Go::Stone::BLACK)
      goban = goban.play([ 0, 1 ], Go::Stone::WHITE)
      goban = goban.play([ 2, 1 ], Go::Stone::WHITE)
      goban = goban.play([ 1, 0 ], Go::Stone::WHITE)
      goban = goban.play([ 1, 2 ], Go::Stone::WHITE)

      # Black stone should be captured (has no liberties)
      expect(goban.stone_at([ 1, 1 ])).to eq(Go::Stone::EMPTY)
      expect(goban.captures[Go::Stone::WHITE]).to eq(1)
    end

    it "captures corner stone with fewer surrounding stones" do
      goban = Go::Goban.with_dimensions(cols: 4, rows: 4)

      # Corner moves should be legal
      expect(goban.is_legal?([ 0, 0 ], Go::Stone::BLACK)).to be true

      # Test that corner stones can be captured with only adjacent stones
      goban = goban.play([ 0, 0 ], Go::Stone::BLACK)
      goban = goban.play([ 1, 0 ], Go::Stone::WHITE)
      goban = goban.play([ 0, 1 ], Go::Stone::WHITE)

      # Black corner stone should be captured (only needs 2 surrounding stones)
      expect(goban.stone_at([ 0, 0 ])).to eq(Go::Stone::EMPTY)
      expect(goban.captures[Go::Stone::WHITE]).to eq(1)
    end

    it "validates legal moves" do
      goban = Go::Goban.with_dimensions(cols: 4, rows: 4)
      expect(goban.is_legal?([ 0, 0 ], Go::Stone::BLACK)).to be true

      goban = goban.play([ 0, 0 ], Go::Stone::BLACK)
      expect(goban.is_legal?([ 0, 0 ], Go::Stone::WHITE)).to be false
    end
  end
end
