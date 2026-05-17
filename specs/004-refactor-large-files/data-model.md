# Data Model

**Feature**: Refactor Large Files  
**Status**: Not applicable

This feature is a pure code reorganization. No new database tables, columns, API schemas, or data structures are introduced. All existing types, tables, and serialization formats remain unchanged.

Existing entities (unchanged):
- `go_engine::territory::PlayerPoints`, `GameScore` — score types
- `go_engine::Engine`, `Goban`, `Stone`, `Turn`, `Stage` — core game types
- `seki_web::models::game::Game`, `GameWithPlayers` — DB models
- `seki_web::models::user::User` — user model
- `seki_web::models::message::Message` — chat model
- `seki_web::models::turn::TurnRow` — move history model
- Frontend `UiCapabilities`, `LiveGameControlsState`, etc. — TypeScript types
