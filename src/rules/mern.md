# MERN Stack Development Rules

When generating or editing MERN stack applications (MongoDB + Express.js + React + Node.js), strictly adhere to:

## Backend (Node.js / Express)

1. **Route Structure:** Always follow RESTful conventions. Use `express.Router()` and mount routes in `app.js` or `server.js`.
2. **Error Middleware:** All async route handlers MUST be wrapped with `try/catch`. Use a centralized error-handling middleware `(err, req, res, next)` at the end of the middleware stack.
3. **Environment Variables:** NEVER hardcode secrets. Use `process.env.VARIABLE_NAME`. Always reference `.env.example` for required vars.
4. **Mongoose Models:** Define schemas with proper types, validators, and indexes. Never skip validation.
5. **Controllers:** Keep route handlers thin — delegate business logic to controller functions in `controllers/` or `services/`.
6. **Response Format:** Always respond with consistent JSON: `{ success: true, data: ... }` or `{ success: false, error: "message" }`.

## Frontend (React)

1. **Component Structure:** Functional components only. Use React Hooks (`useState`, `useEffect`, `useContext`, `useReducer`).
2. **State Management:** Prefer React Context + `useReducer` for global state. Only use Redux if the project already uses it.
3. **API Calls:** Use `axios` or `fetch`. Always handle loading/error states. Never leave unhandled promise rejections.
4. **File Extensions:** `.jsx` for components with JSX. `.js` for pure logic/helpers.
5. **Imports:** Always use relative paths within `src/`. Use aliases (e.g. `@/`) if already configured in the project.

## Database (MongoDB)

1. Use indexed fields for all frequently queried properties.
2. Never store plain-text passwords — always use `bcryptjs` or `argon2`.
3. Use Mongoose `populate()` sparingly; prefer explicit query joins for performance-critical paths.

## Commands Order

Always install dependencies FIRST, then run the app:
```
COMMAND: npm install <packages>
COMMAND: npm run dev
```
