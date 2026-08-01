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

### Running the app
- The dev server is started by the user via `npm run dev` (nodemon server.js)
- Do NOT start the server yourself; it is already running on `http://localhost:3000`
- Do NOT kill the running server
- Verify endpoints with `curl http://localhost:3000/...` against the already-running instance