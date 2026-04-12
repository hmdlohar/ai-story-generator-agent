# AGENTS.md

## Development Guidelines

### View Pattern
- Pure static HTML/CSS/JS for all views
- No server-side templating (no EJS, no template literals in server.js for views)
- Server only exposes APIs (JSON endpoints)
- Views make fetch() calls to APIs

### Server Pattern
- Express serves only:
  - Static files (public/)
  - API endpoints returning JSON
- No HTML string interpolation in server.js