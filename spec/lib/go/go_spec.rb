require "rspec"
require_relative "../../../app/lib/go"

RSpec.describe Go do
  def goban_from_layout(layout)
    rows = layout.map { |row|
      row.chars.map { |c|
        case c
        when "B" then Go::Stone::BLACK
        when "W" then Go::Stone::WHITE
        when "+" then Go::Stone::EMPTY
        end
      }
    }
    Go::Goban.new(rows)
  end

  describe Go::Goban do
    it "regects malformed board" do
      layout = [
        "+",
        "++"
      ]
      expect {
        goban_from_layout(layout)
      }.to raise_error(ArgumentError)
    end

    it "prevents overwrite moves" do
      goban = Go::Goban.with_dimensions(cols: 4)
      goban = goban.play([0, 0], Go::Stone::BLACK)
      expect {
        goban.play([0, 0], Go::Stone::WHITE)
      }.to raise_error(Go::OccupiedPoint)
    end

    it "prevents ko violation" do
      layout = [
        "+BW+",
        "BW+W",
        "+BW+",
        "++++"
      ]
      goban = goban_from_layout(layout)
      goban = goban.play([2, 1], Go::Stone::BLACK)
      expect {
        goban.play([1, 1], Go::Stone::WHITE)
      }.to raise_error(Go::KoViolation)
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
        goban = goban.play([0, 0], Go::Stone::WHITE)
      }.to raise_error(Go::Suicide)
    end

    it "captures single stone" do
      layout = [
        "+B++",
        "BWB+",
        "++++",
        "++++"
      ]
      goban = goban_from_layout(layout)
      goban = goban.play([1, 2], Go::Stone::BLACK)
      expect(goban.captures[:black]).to eq(1)
    end

    it "captures stone chains" do
      layout = [
        "+BB+",
        "BWWB",
        "W+WB",
        "WWB+"
      ]
      goban = goban_from_layout(layout)
      goban = goban.play([1, 2], Go::Stone::BLACK)
      expect(goban.captures[:black]).to eq(6)
    end
  end

  describe "normalize stone" do
    it "handles symbol and numeric inputs" do
      expect(Go::Stone.normalize(:black)).to eq(Go::Stone::BLACK)
      expect(Go::Stone.normalize(1)).to eq(Go::Stone::BLACK)
      expect(Go::Stone.normalize(:white)).to eq(Go::Stone::WHITE)
      expect(Go::Stone.normalize(-1)).to eq(Go::Stone::WHITE)
      expect(Go::Stone.normalize(0)).to eq(Go::Stone::EMPTY)
    end

    it "raises on bad input" do
      expect { Go::Stone.normalize(:green) }.to raise_error(ArgumentError)
    end
  end
end
