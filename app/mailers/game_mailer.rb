class GameMailer < ApplicationMailer
  def invite
    @game = params[:game]
    @url = game_url(@game)

    mail(
      to: params[:email],
      subject: "You're invited to join a game of go!"
    )
  end
end
