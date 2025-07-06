class GameMailer < ApplicationMailer
  def invite
    @game = params[:game]
    @url = game_invitation_url(@game) << "?email=#{params[:email]}&token=#{params[:token]}"

    mail(
      to: params[:email],
      subject: "You're invited to join a game of go!"
    )
  end
end
