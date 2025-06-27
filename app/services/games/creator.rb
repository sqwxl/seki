module Games
  class Creator
    def initialize(current_player, params)
      @player = current_player
      @params = params
    end

    def call
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

    def game_params
      @params.require(:game).permit(:cols, :rows, :handicap, :komi)
    end

    def find_or_create_friend
      Player.find_or_create_by(email: @params[:invite_email]) if @params[:invite_email].present?
    end

    def assign_colors(game, friend)
      case @params[:color]
      when "black" then game.black, game.white = @player, friend
      when "white" then game.black, game.white = friend, @player
      else game.black, game.white = [@player, friend].shuffle
      end
    end
  end
end
