require "rails_helper"

RSpec.describe Go::Stone do
  describe "constants" do
    it "defines stone values" do
      expect(Go::Stone::BLACK).to eq(1)
      expect(Go::Stone::WHITE).to eq(-1)
      expect(Go::Stone::EMPTY).to eq(0)
    end
  end

  describe "normalization" do
    it "handles symbol and numeric inputs" do
      expect(Go::Stone.normalize(:black)).to eq(Go::Stone::BLACK)
      expect(Go::Stone.normalize(1)).to eq(Go::Stone::BLACK)
      expect(Go::Stone.normalize(:white)).to eq(Go::Stone::WHITE)
      expect(Go::Stone.normalize(-1)).to eq(Go::Stone::WHITE)
      expect(Go::Stone.normalize(0)).to eq(Go::Stone::EMPTY)
      expect(Go::Stone.normalize(:empty)).to eq(Go::Stone::EMPTY)
    end

    it "normalizes positive integers to black" do
      expect(Go::Stone.normalize(5)).to eq(Go::Stone::BLACK)
      expect(Go::Stone.normalize(100)).to eq(Go::Stone::BLACK)
    end

    it "normalizes negative integers to white" do
      expect(Go::Stone.normalize(-5)).to eq(Go::Stone::WHITE)
      expect(Go::Stone.normalize(-100)).to eq(Go::Stone::WHITE)
    end

    it "raises on bad input" do
      expect { Go::Stone.normalize(:green) }.to raise_error(ArgumentError)
      expect { Go::Stone.normalize("black") }.to raise_error(ArgumentError)
      expect { Go::Stone.normalize(nil) }.to raise_error(ArgumentError)
    end
  end

  describe "string representation" do
    it "converts stones to readable strings" do
      expect(Go::Stone.name(Go::Stone::BLACK)).to eq("Black")
      expect(Go::Stone.name(Go::Stone::WHITE)).to eq("White")
      expect(Go::Stone.name(Go::Stone::EMPTY)).to eq("Empty")
    end

    it "normalizes input before converting to string" do
      expect(Go::Stone.name(:black)).to eq("Black")
      expect(Go::Stone.name(1)).to eq("Black")
      expect(Go::Stone.name(-1)).to eq("White")
      expect(Go::Stone.name(0)).to eq("Empty")
    end
  end
end
