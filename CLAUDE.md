# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Seki is a Ruby on Rails application for playing the board game Go (Weiqi/Baduk) with real-time multiplayer functionality. The application features:

- Real-time Go gameplay using ActionCable WebSockets
- Custom Go game engine implemented in Ruby (`lib/go/`)
- Frontend built with Preact and HTM for the game board interface
- Player management, game creation, and move validation
- Territory review and game result calculation
- Undo request system

## Development Commands

### Ruby/Rails Commands
- `bundle install` - Install Ruby dependencies
- `bin/rails server` - Start the Rails development server
- `bin/rails console` - Open Rails console
- `bin/rails db:migrate` - Run database migrations
- `bin/rails db:seed` - Seed the database

### JavaScript/Build Commands
- `yarn install` - Install JavaScript dependencies  
- `yarn build` - Build JavaScript assets using esbuild
- Build output goes to `app/assets/builds/`

### Testing
- `bundle exec rspec` - Run RSpec tests
- `bundle exec rspec spec/path/to/spec.rb` - Run specific test file
- Both RSpec and Minitest are configured (legacy Minitest in `test/` directory)

### Code Quality
- `bundle exec rubocop` - Run Ruby linter (uses omakase style guide)
- `bundle exec rubocop -A` - Auto-fix Ruby style issues

## Architecture Overview

### Go Game Engine (`lib/go/`)
- **Engine**: Main game controller managing board state and moves
- **Goban**: Represents the Go board with stone placement and capture logic
- **Stone**: Enum-like class for BLACK/WHITE/EMPTY stone states
- **Move**: Represents individual game moves with position and metadata
- All game logic is encapsulated in these classes, separate from Rails models

### Models
- **Game**: Central model linking players, managing game state and settings
- **Player**: User accounts for game participants
- **GameMove**: Persists moves to database with game engine coordination
- **TerritoryReview**: Handles end-game territory marking and scoring
- **UndoRequest**: Manages undo functionality between players

### Real-time Features
- **GameChannel**: ActionCable channel handling move placement, chat, undo requests
- **JavaScript Frontend**: Preact-based UI in `app/javascript/go.js` and `app/javascript/goban/`
- WebSocket communication for live game updates

### Key Services
- **Games::Creator**: Handles game creation logic
- **Games::EngineBuilder**: Reconstructs game state from database moves
- **CurrentPlayerResolver**: Determines active player context

### Frontend Structure
- Main game interface: `app/javascript/go.js`
- Goban rendering: `app/javascript/goban/` (modular components)
- Stimulus controllers for interactive elements
- Preact components for reactive game board

## Development Notes

### Game State Management
The application maintains game state in two places:
1. Database models (Game, GameMove, Player) for persistence
2. Go::Engine instances for game logic and validation

The EngineBuilder service reconstructs engine state from database moves when needed.

### WebSocket Communication
Real-time features use ActionCable channels:
- Stone placement broadcasts to all game participants
- Chat messages and game status updates
- Undo request coordination

### Testing Strategy
- RSpec for Ruby code (models, services, channels)
- Legacy Minitest in `test/` directory
- Both test databases configured (SQLite)
- **Tests should reflect the current implementation, and not past implementations, or changes in implementation details.**
- When writing tests, first take a look at the code you are testing.

## Migration Management
- When editing schemas, don't generate a new migration. Instead, roll back the current -- and only -- migration, edit it directly, and migrate back.
- Always adjust db schema by rolling back and editing the one and only migration file.

## Debugging and Development Tips
- When working on failing tests, remember to consider that the underlying code may be at fault, and not the test itself.
- When working on code, always make sure the problem you are working hasn't already been solved or worked on elsewhere in the codebase.

## Go Game Rules
- The minimum handicap in a game of Go is 2 stones.

## Communication Guidelines
- When responding, stick to the subject at hand, no need to compliment me or use phrases like "You're absolutely right!". Just get to the point, please.