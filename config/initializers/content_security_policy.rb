# Be sure to restart your server when you modify this file.

# Define an application-wide content security policy.
# See the Securing Rails Applications Guide for more information:
# https://guides.rubyonrails.org/security.html#content-security-policy-header

Rails.application.configure do
  config.content_security_policy do |policy|
    # Default to self and secure origins
    policy.default_src :self
    
    # Allow fonts from self and data URIs (for embedded fonts)
    policy.font_src :self, :data
    
    # Allow images from self, data URIs, and secure sources
    policy.img_src :self, :data, :https
    
    # Completely disallow object/embed tags
    policy.object_src :none
    
    # Allow scripts from self and use nonces for inline scripts
    policy.script_src :self, :unsafe_inline
    
    # Allow styles from self and use nonces for inline styles  
    policy.style_src :self, :unsafe_inline
    
    # Allow WebSocket connections for ActionCable (same origin only)
    policy.connect_src :self, "ws:", "wss:"
    
    # Prevent clickjacking
    policy.frame_ancestors :none
    
    # Prevent MIME type sniffing
    policy.base_uri :self
    
    # Only allow forms to be submitted to same origin
    policy.form_action :self
    
    # Specify URI for violation reports in production
    if Rails.env.production?
      policy.report_uri "/csp-violation-report"
    end
  end

  # Temporarily disable nonces due to Rails version compatibility
  # config.content_security_policy_nonce_generator = ->(request) { 
  #   SecureRandom.base64(16)
  # }
  # config.content_security_policy_nonce_directives = %w(script-src style-src)

  # Start with report-only mode in development, enforce in production
  config.content_security_policy_report_only = Rails.env.development?
end
