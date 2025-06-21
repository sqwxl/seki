module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :current_player

    def connect
      self.current_player ||= CurrentPlayerResolver.new(request.session).resolve!
    end
  end
end
