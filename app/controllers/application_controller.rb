class ApplicationController < ActionController::Base
  # Only allow modern browsers supporting webp images, web push, badges, import maps, CSS nesting, and CSS :has.
  allow_browser versions: :modern

  before_action :identify_player

  private

  def identify_player
    session[:player_id] ||= SecureRandom.uuid
  end
end
