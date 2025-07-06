# System test configuration for Rails E2E testing
RSpec.configure do |config|
  config.before(:each, type: :system) do
    driven_by :rack_test
  end

  config.before(:each, type: :system, js: true) do
    # Auto-detect available Chrome/Chromium browsers
    chrome_binary = detect_chrome_binary
    
    if chrome_binary.nil?
      skip "JavaScript tests require Chrome/Chromium. Install chrome, chromium, or google-chrome to run JS tests."
    end
    
    # Configure Chrome driver with detected binary
    Capybara.register_driver :selenium_chrome_headless_auto do |app|
      options = Selenium::WebDriver::Chrome::Options.new
      
      # Only set binary for native Chrome installations
      # Let Selenium auto-detect for flatpak/snap installations
      if chrome_binary && !chrome_binary.is_a?(Array)
        options.binary = chrome_binary
      end
      # For flatpak (Array), don't set binary - let Selenium auto-detect
      
      # Lightweight options for minimal memory usage
      options.add_argument("--headless")
      options.add_argument("--no-sandbox")
      options.add_argument("--disable-dev-shm-usage")
      options.add_argument("--disable-gpu")
      options.add_argument("--disable-extensions")
      options.add_argument("--window-size=800,600")
      
      Capybara::Selenium::Driver.new(app, browser: :chrome, options: options)
    end
    
    driven_by :selenium_chrome_headless_auto
  end
  
  # Helper method to detect available Chrome installations
  def detect_chrome_binary
    # Try different Chrome/Chromium installations in order of preference
    [
      # Standard Chrome installations
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable", 
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/opt/google/chrome/chrome",
      
      # Snap Chrome
      "/snap/bin/chromium",
      
      # Check PATH for common names
      `which google-chrome-stable 2>/dev/null`.strip,
      `which google-chrome 2>/dev/null`.strip,
      `which chromium 2>/dev/null`.strip,
      `which chromium-browser 2>/dev/null`.strip,
    ].compact.find { |path| path && !path.empty? && File.executable?(path) } ||
    
    # Flatpak Chrome (return as command array)
    (system("flatpak list | grep -q com.google.Chrome") ? ["flatpak", "run", "com.google.Chrome"] : nil) ||
    
    # Flatpak Chromium
    (system("flatpak list | grep -q org.chromium.Chromium") ? ["flatpak", "run", "org.chromium.Chromium"] : nil)
  end
  
  # Create a temporary wrapper script for flatpak commands
  def create_chrome_wrapper(command_array)
    require 'tempfile'
    
    wrapper = Tempfile.new(['chrome_wrapper', '.sh'])
    wrapper.write("#!/bin/bash\n")
    wrapper.write("# Chrome wrapper for #{command_array.join(' ')}\n")
    wrapper.write("exec #{command_array.join(' ')} \"$@\"\n")
    wrapper.close
    File.chmod(0755, wrapper.path)
    
    puts "Created Chrome wrapper: #{wrapper.path}" if ENV['DEBUG_CHROME']
    puts "Wrapper content:\n#{File.read(wrapper.path)}" if ENV['DEBUG_CHROME']
    
    # Store reference so it doesn't get garbage collected
    @chrome_wrapper = wrapper
    
    wrapper.path
  end
end

# Configure Capybara for system tests
Capybara.configure do |config|
  config.server = :puma, { Silent: true }
  config.default_max_wait_time = 2  # Shorter timeout
end

# Helper methods for system tests
module SystemTestHelpers
  def using_session(name)
    Capybara.using_session(name) { yield }
  end
  
  # Helper to set session data for system tests
  def set_session_for_player(player)
    # For system tests, we need to simulate the session differently
    # Let's use URL parameters or modify the test approach
    page.driver.browser.manage.add_cookie(
      name: 'player_session', 
      value: player.session_token,
      path: '/'
    )
  end

  def wait_for_actioncable
    # Give ActionCable connections time to establish
    sleep 0.5
  end

  def wait_for_game_state_update
    # Wait for WebSocket updates to propagate
    sleep 1
  end
end

RSpec.configure do |config|
  config.include SystemTestHelpers, type: :system
  
  # Cleanup after JavaScript tests
  config.after(:each, type: :system, js: true) do
    # Reset the current session (closes browser gracefully)
    Capybara.current_session.reset!
  end
  
  # Cleanup at the end of the test suite
  config.after(:suite) do
    # Reset all sessions
    Capybara.reset_sessions!
  end
end