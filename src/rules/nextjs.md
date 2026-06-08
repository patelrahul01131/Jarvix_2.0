# Next.js Development Rules

When generating or editing Next.js applications, strictly adhere to:

## App Router (Next.js 13+)

1. **File conventions:** Use `page.tsx`/`page.jsx` for routes, `layout.tsx` for layouts, `loading.tsx` for loading UI, `error.tsx` for error boundaries.
2. **Server vs Client components:** Default to Server Components. Add `"use client"` ONLY when you need browser APIs, event handlers, or React hooks (`useState`, `useEffect`).
3. **Data Fetching:** Use `async/await` directly in Server Components. Use React Query or SWR only for client-side dynamic data.
4. **API Routes:** Place in `app/api/<route>/route.ts`. Export named functions `GET`, `POST`, `PUT`, `DELETE`.
5. **Metadata:** Always define `export const metadata` or `generateMetadata()` in `page.tsx` files.

## Pages Router (Next.js 12 and below)

1. Use `getServerSideProps` for server-side rendering, `getStaticProps` + `getStaticPaths` for static generation.
2. API routes go in `pages/api/`. Export a single default handler function.

## Styling

1. Prefer **CSS Modules** (`*.module.css`) or **Tailwind CSS** if already set up.
2. Do NOT mix global CSS with module CSS in the same component.
3. For Tailwind: use the correct v3/v4 class names. Do not invent utility classes.

## TypeScript

1. Always type props with interfaces or types. Never use `any` unless unavoidable.
2. Type all API response shapes. Use `zod` for runtime validation if already in the project.

## Performance

1. Use `next/image` for all images — never plain `<img>` tags.
2. Use `next/font` for fonts — never load fonts via `<link>` in `_document`.
3. Lazy-load heavy components using `dynamic(() => import(...), { ssr: false })`.

## Commands Order

```
COMMAND: npm install <packages>
COMMAND: npm run dev
```
