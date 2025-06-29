module Games
  class Creator
    def self.call(current_player, params)
      @player = current_player
      @params = params

      Game.transaction do
        game = Game.new(game_params)
        game.creator = @player
        friend = find_or_create_friend
        assign_colors(game, friend)
        game.save!

        game
      end
    end

    private

    def self.game_params
      @params.require(:game).permit(:cols, :rows, :is_handicap, :handicap, :komi)
    end

    def self.find_or_create_friend
      Player.find_or_create_by(email: @params[:invite_email]) if @params[:invite_email].present?
    end

    def self.assign_colors(game, friend)
      case @params[:color]
      when "black" then game.black, game.white = @player, friend
      when "white" then game.black, game.white = friend, @player
      else game.black, game.white = [ @player, friend ].shuffle
      end
    end
  end
end
