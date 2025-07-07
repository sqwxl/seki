require "rails_helper"

RSpec.describe Message, type: :model do
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

  describe "associations" do
    let(:message) do
      Message.create!(
        game: game,
        player: black_player,
        text: "Good game!"
      )
    end

    it "belongs to game" do
      expect(message.game).to eq(game)
    end

    it "belongs to player" do
      expect(message.player).to eq(black_player)
    end

    it "is included in game messages" do
      expect(game.messages).to include(message)
    end
  end

  describe "validations" do
    it "requires game" do
      message = Message.new(player: black_player, text: "test")
      expect(message).not_to be_valid
      expect(message.errors[:game]).to include("must exist")
    end

    it "requires player" do
      message = Message.new(game: game, text: "test")
      expect(message).not_to be_valid
      expect(message.errors[:player]).to include("must exist")
    end

    it "requires text" do
      message = Message.new(game: game, player: black_player)
      expect(message).not_to be_valid
      expect(message.errors[:text]).to include("can't be blank")
    end

    it "is valid with all required attributes" do
      message = Message.new(game: game, player: black_player, text: "Hello!")
      expect(message).to be_valid
    end
  end

  describe "message creation" do
    it "can create message with basic text" do
      message = Message.create!(
        game: game,
        player: black_player,
        text: "Good luck!"
      )

      expect(message).to be_persisted
      expect(message.text).to eq("Good luck!")
    end

    it "can create message with long text" do
      long_text = "A" * 1000
      message = Message.create!(
        game: game,
        player: black_player,
        text: long_text
      )

      expect(message.text).to eq(long_text)
    end

    it "can create message with special characters" do
      special_text = "Thanks! 😊 Great move at Q16 👍"
      message = Message.create!(
        game: game,
        player: black_player,
        text: special_text
      )

      expect(message.text).to eq(special_text)
    end
  end

  describe "player messaging" do
    it "allows black player to send messages" do
      message = Message.create!(
        game: game,
        player: black_player,
        text: "Playing as black"
      )

      expect(message.player).to eq(black_player)
    end

    it "allows white player to send messages" do
      message = Message.create!(
        game: game,
        player: white_player,
        text: "Playing as white"
      )

      expect(message.player).to eq(white_player)
    end

    it "allows creator to send messages" do
      message = Message.create!(
        game: game,
        player: creator,
        text: "Game creator speaking"
      )

      expect(message.player).to eq(creator)
    end

    it "allows any player to send messages to the game" do
      other_player = Player.create!(email: "observer@example.com")
      message = Message.create!(
        game: game,
        player: other_player,
        text: "Observing this game"
      )

      expect(message.player).to eq(other_player)
    end
  end

  describe "message ordering" do
    it "orders messages by creation time" do
      first_message = Message.create!(
        game: game,
        player: black_player,
        text: "First message"
      )

      second_message = Message.create!(
        game: game,
        player: white_player,
        text: "Second message"
      )

      third_message = Message.create!(
        game: game,
        player: black_player,
        text: "Third message"
      )

      expect(game.messages.pluck(:id)).to eq([
        first_message.id,
        second_message.id,
        third_message.id
      ])
    end
  end

  describe "cascading deletes" do
    it "is deleted when game is deleted" do
      message = Message.create!(
        game: game,
        player: black_player,
        text: "This will be deleted"
      )

      message_id = message.id
      game.destroy!

      expect(Message.exists?(message_id)).to be_falsey
    end

    it "cannot be deleted when player is deleted due to foreign key constraint" do
      Message.create!(
        game: game,
        player: black_player,
        text: "This will remain"
      )

      expect { black_player.destroy! }.to raise_error(ActiveRecord::InvalidForeignKey)
    end
  end

  describe "timestamps" do
    it "sets created_at when message is created" do
      message = Message.create!(
        game: game,
        player: black_player,
        text: "Timestamped message"
      )

      expect(message.created_at).to be_within(1.second).of(Time.current)
    end

    it "sets updated_at when message is created" do
      message = Message.create!(
        game: game,
        player: black_player,
        text: "Timestamped message"
      )

      expect(message.updated_at).to be_within(1.second).of(Time.current)
    end

    it "updates updated_at when message is modified" do
      message = Message.create!(
        game: game,
        player: black_player,
        text: "Original text"
      )

      original_updated_at = message.updated_at
      sleep(0.01)  # Ensure timestamp difference

      message.update!(text: "Updated text")
      expect(message.updated_at).to be > original_updated_at
    end
  end
end
