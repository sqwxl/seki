class ApplicationController < ActionController::Base
  # Only allow modern browsers supporting webp images, web push, badges, import maps, CSS nesting, and CSS :has.
  allow_browser versions: :modern

  rescue_from ActiveRecord::RecordNotFound, with: :render_not_found

  helper_method :current_player

  before_action :ensure_player!

  protected

    def current_player
      @current_player
    end

  private

    def ensure_player!
      @current_player = CurrentPlayerResolver.new(session).resolve!
    end

    def render_not_found
      # TODO Redirect to root with an alert?
      render file: Rails.root.join("public/404.html"), status: :not_found, layout: false
    end
end
