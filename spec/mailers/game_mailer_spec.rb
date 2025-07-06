require "rails_helper"

RSpec.describe GameMailer, type: :mailer do
  let(:player) { Player.create!(email: 'player@example.com') }
  let(:other_player) { Player.create!(email: 'invited@example.com') }
  let(:game) do
    Game.create!(
      creator: player,
      black: player,
      white: other_player,
      cols: 19,
      rows: 19,
      komi: 6.5,
      handicap: 2
    )
  end

  describe "#invite" do
    let(:mail) do
      GameMailer.with(game: game, email: other_player.email).invite
    end

    it "renders the headers" do
      expect(mail.subject).to eq("You're invited to join a game of go!")
      expect(mail.to).to eq([ other_player.email ])
      expect(mail.from).to eq([ "from@example.com" ]) # Adjust based on your app config
    end

    it "includes the game URL in the body" do
      expect(mail.body.encoded).to include(game_url(game))
    end

    it "includes game information" do
      expect(mail.body.encoded).to include("game")
    end
  end
end