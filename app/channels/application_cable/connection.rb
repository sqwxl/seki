module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :session_id

    def connect
      self.session_id = request.session[:player_id] ||= SecureRandom.uuid
    end
  end
end
