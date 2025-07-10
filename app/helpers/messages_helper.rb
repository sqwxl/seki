module MessagesHelper
  def serialized_chat_log(game)
    ERB::Util.html_escape(game.messages.includes(:player).order(:created_at).map do |msg|
      {
        sender: msg.sender_label,
        text: msg.text,
        sent_at: msg.created_at
      }
    end.to_json)
  end
end
