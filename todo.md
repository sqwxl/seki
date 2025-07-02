Fix undo requests showing to all players instead of just opponent
Fix undo request status not shown when connecting to game
Fix undo acceptance/rejection results broadcast to everyone
Fix request-undo button never re-enabled after rejection
Show specific move number in undo request dialog
Add pending undo request info to initial view data
Target undo requests to responding player only using transmit()
Target undo responses to requester only
Check for pending requests on page load and display appropriately
Reset button state when undo request is resolved
Add username validation to Player model
Implement public game listing in games#index
Add private game authorization to join action
Extend Games::Creator for username invitations
Update game creation form with username field
Add proper error messages and flash notifications
Write tests for undo mechanism fixes
Write tests for new game functionality
Fix email notification parameter handling
Add game listing pagination and filtering
Implement search functionality
Add game discovery enhancements
Create comprehensive integration tests
Add UI/UX improvements for game browsing