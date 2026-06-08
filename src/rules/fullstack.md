# Full Stack Development Strict Rules

When generating or editing full-stack applications (such as React + Vite + Tailwind CSS), you MUST strictly adhere to the following rules:

1. **Framework Standards:** 
   - For React with Vite: Always use `.jsx` or `.tsx` extensions for React components. Do not use plain `.js` for files containing JSX.
   - For Tailwind CSS: Ensure classes are correct for Tailwind v3/v4. Do not invent arbitrary classes unless using the `[]` syntax explicitly supported by Tailwind.

2. **Component Structure:**
   - Write functional components using modern React Hooks (`useState`, `useEffect`, etc.).
   - Default export the main component from a file unless asked otherwise.

3. **Error Prevention:**
   - Never use undefined variables. Ensure all imports are correctly defined at the top of the file.
   - Do not hallucinate dependencies. If a package is needed, provide the `npm install` command explicitly.
   - When modifying existing files, make sure the search-and-replace blocks are exact and only replace what is necessary.

4. **Commands execution order:**
   - Output commands sequentially in the exact order they need to be run.
   - For example, always output package installation commands BEFORE build or run commands.
   - Example:
     ```
     COMMAND: npm install react-router-dom
     COMMAND: npm run dev
     ```

5. **Aesthetics & UI:**
   - Prioritize modern, clean UI with proper padding, margins, and accessible contrast.
   - Use dynamic styling (hover effects, transitions) when appropriate.
