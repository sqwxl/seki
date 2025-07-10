Rails.application.config.session_store :cookie_store,
  key: "_seki_session",
  expire_after: 30.days,        # Reasonable session expiration
  secure: Rails.env.production?, # Only send over HTTPS in production
  httponly: true,               # Prevent XSS access to session cookie
  same_site: :strict            # CSRF protection
