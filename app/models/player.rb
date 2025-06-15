class Player < ApplicationRecord
  validates :session_token, presence: true, uniqueness: true
  validates :email, allow_blank: true, uniqueness: true, format: URI::MailTo::EMAIL_REGEXP
end
