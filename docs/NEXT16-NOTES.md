# Next.js 16.4 notes (PRESTİJ)

These notes cover Next 16.4.5, React 19.3 and Tailwind 4, with `cacheComponents: true` and `partialPrefetching: true`.
Every rule below comes from the bundled docs. Paths are relative to `node_modules/next/dist/docs/01-app/`.
When in doubt, open the cited file. Don't rely on memory of Next 14 or 15. Notes marked **(project)** are our own decisions, not doc rules.

## 1. The Cache Components model
Sources: `01-getting-started/08-caching.md`, `03-api-reference/01-directives/use-cache.md`, `03-api-reference/04-functions/cacheLife.md`, `03-api-reference/04-functions/cacheTag.md`, `02-guides/migrating-to-cache-components.md`, `02-guides/building.md`, `02-guides/keeping-pages-static.md`, `03-api-reference/03-file-conventions/02-route-segment-config/{ensureStatic,instant}.md`

- **Data is uncached (dynamic) by default.** Nothing is cached unless it is inside `"use cache"`. At build time every route is prerendered into a **static shell** (PPR is always on). How each part of the tree is handled:
  - **Static, included in the shell automatically:** pure computation, module imports, `fs.readFileSync`.
  - **Cached, included in the shell:** anything inside `"use cache"`, unless its lifetime is short (see cacheLife below).
  - **Must sit inside `<Suspense>`:** uncached async work (fetch or DB calls) and runtime APIs (`cookies()`, `headers()`, `searchParams`, `params` with no `generateStaticParams`, `connection()`). The fallback goes into the shell and the content streams at request time.
  - **Random values and timestamps:** `Math.random()`, `Date.now()` and `crypto.randomUUID()` must run after `await connection()` (inside Suspense) or inside `"use cache"`. `instant = false` does **not** silence these errors.
- Reading `cookies()` no longer makes the whole route dynamic. Only the Suspense subtree around the read streams.
- If the access is not handled, the build fails and dev shows a "blocking-route" insight:
  ```
  Error: Route "/products/[id]": Next.js encountered uncached or runtime data during prerendering.
  `fetch(...)`, `cookies()`, `headers()`, `params`, `searchParams`, or `connection()` accessed outside of `<Suspense>` …
  Ways to fix this: [stream] <Suspense fallback> · [cache] "use cache" · [block] export const instant = false
  ```
  To find the line, use `next build --debug-prerender`, or open the route in `next dev` (the overlay shows source-mapped stacks).
- Push awaits down the tree. Don't `await params`, `cookies()` or data at the top of a layout. Pass the promise to a child that sits inside `<Suspense>`.
- **Removed or forbidden with Cache Components:** the segment configs `dynamic`, `revalidate`, `fetchCache` and `dynamicParams` all cause an error. **Any** `runtime` export is unsupported (remove it, even `'nodejs'`). `experimental_ppr` is gone and `unstable_noStore` is unnecessary. Replace `revalidate = 3600` with `"use cache"` + `cacheLife('hours')`.

### `"use cache"`
- It can go at file level (every export becomes cached and must be async), function level or component level. Cached functions must be `async`.
- **Cache key:** build ID + function ID + serialized arguments + any closed-over variables. A new deploy starts with an empty cache, including `use cache: remote`.
- **Allowed arguments:** primitives, plain objects, arrays, Date, Map, Set and typed arrays. **Not allowed:** class instances, functions, Symbols and `URL` instances. Return values can also be JSX. `children` and Server Actions can be *passed through* as long as the function does not read them.
- **No `cookies()`, `headers()` or `searchParams` inside, anywhere down the call stack.** Doing so throws `next-request-in-use-cache`. Read these values outside and pass plain values in.
  - Passing a runtime *promise* (an unawaited `cookies()` or `params`) into a cached function makes the build hang. It fails after 50 s with "Filling a cache during prerender timed out".
- **Allowed inside:** `draftMode().isEnabled`, and root-param getters from `next/root-params` (only the ones actually read join the key). `React.cache` is isolated inside a cached scope, so it can't pass values in.
- **Storage:** an in-memory LRU store per instance. Entries don't survive across requests on serverless; they do on a self-hosted server. `"use cache: remote"` uses a durable shared handler. `"use cache: private"` may read cookies and headers, but its results live only in the browser.

### `cacheLife` (`import { cacheLife } from 'next/cache'`)
- Call it inside every `"use cache"` scope. Calling it at module scope throws, and only one call may run per invocation.
- If you leave it out, the `default` profile applies. Nesting a short-lived cache inside a `use cache` scope that has no explicit cacheLife is a **build error**.

| profile | stale (client) | revalidate (server SWR) | expire |
|---|---|---|---|
| default | 5m | 15m | never |
| seconds | 30s | 1s | 1m |
| minutes | 5m | 1m | 1h |
| hours | 5m | 1h | 1d |
| days | 5m | 1d | 1w |
| weeks | 5m | 1w | 30d |
| max | 5m | 30d | 1y |

- **`stale`** controls the client router cache. A minimum of 30 s is enforced. **`revalidate`** sets when a request triggers a background regeneration. **`expire`** sets when a request must block for fresh content.
- **Short lifetimes change what gets prerendered:**
  - `revalidate: 0` or `expire` under 5 min (`seconds` is the only preset affected): the content is left out of the prerender and becomes a dynamic hole, so wrap it in Suspense.
  - `stale` under 30 s: left out of the prerender.
  - `stale` between 30 s and 5 min: prerendered, but **not** part of the App Shell.
- **Custom profiles:** add `cacheLife: { catalog: { stale, revalidate, expire } }` to `next.config.ts`. Any field you omit inherits from `default`.

### `cacheTag`
- `cacheTag('products', 'product:gul-sabunu')` goes inside `"use cache"`. Limits: 128 tags per call, 256 characters per tag, case-sensitive.
- Never put secrets or personal data in tags or arguments. Both are stored as plain text (`02-guides/authentication-with-cache-components.md`).

### Keeping pages static
- `export const ensureStatic = 'shell' | 'prefetch' | 'navigation' | false` can go on a page or a layout. A child segment can be stricter than its parent, never looser.
  - `'navigation'` means the whole route must be fully static, validated in dev and build. It requires `generateStaticParams` returning at least one complete param set.
  - It fails on cookies, headers, searchParams, uncached data, `connection()` and short cacheLifes, **even inside Suspense**.
- `export const instant = false` allows a segment to block (it opts out of validation). It does **not** force the route to be dynamic.

## 2. Revalidation (all imported from `next/cache`)
Sources: `03-api-reference/04-functions/{updateTag,revalidateTag,revalidatePath,refresh}.md`, `01-getting-started/09-revalidating.md`, `02-guides/server-actions.md`, `02-guides/how-revalidation-works.md`, `cacheLife.md#client-cache-behavior`

| API | Signature | Callable in | Behaviour |
|---|---|---|---|
| `updateTag` | `updateTag(tag: string): void` | **Server Actions only** (throws anywhere else) | Expires the tag immediately, so the next read waits for fresh data. The action's response also contains the re-rendered current route. This is **read-your-own-writes**. |
| `revalidateTag` | `revalidateTag(tag: string, profile: string \| { expire?: number }): void` | Server Actions and Route Handlers (not Proxy or Client Components) | Marks the tag stale with stale-while-revalidate: the next request gets stale content and triggers a regeneration. `'max'` is the recommended profile. `{ expire: 0 }` never serves stale content. The **one-argument form is deprecated**. It does **not** re-render inside the action response. |
| `revalidatePath` | `revalidatePath(path: string, type?: 'page' \| 'layout'): void` | Server Actions and Route Handlers | Takes the *route file* path. `type` is required for patterns such as `/[locale]/urun/[slug]`. `('/', 'layout')` purges everything. Called from an action it currently also refreshes every previously visited page when that page is navigated to again. Prefer tags. |
| `refresh` | `refresh(): void` | **Server Actions only** | Re-fetches the current route's RSC payload without invalidating any cache. |

- Calling any of these from a Server Action clears the calling browser's entire client router cache.
- Revalidation happens on the next request for that content, not at the moment of the call.
- With several server instances, invalidation stays **local to one instance**. Fixing that needs a custom `cacheHandlers` handler that implements `updateTags()` and `refreshTags()`.

**Recipe (project): admin saves, storefront updates within seconds and stays static.**
```ts
// src/lib/catalog.ts: shared read; ends up in the static shell
import { cacheLife, cacheTag } from 'next/cache'
export async function getProduct(locale: string, slug: string) {
  'use cache'
  cacheLife('max')                               // no time-based churn; we invalidate on demand
  cacheTag('products', `product:${slug}`)
  return db.product.findUnique({ where: { slug } /* + locale fields */ })
}
// src/app/panel/urunler/actions.ts
'use server'
import { updateTag } from 'next/cache'
export async function saveProduct(prev: State, formData: FormData): Promise<State> {
  await requireAdmin()                           // auth INSIDE every action (see §6)
  const data = schema.parse(Object.fromEntries(formData))
  await db.product.update({ where: { slug: data.slug }, data })
  updateTag('products'); updateTag(`product:${data.slug}`)
  return { ok: true }
}
// src/app/api/webhooks/stock/route.ts: from outside a Server Action
import { revalidateTag } from 'next/cache'
export async function POST(req: Request) {
  /* verify signature first */
  revalidateTag('products', 'max')               // or { expire: 0 } if stale is unacceptable
  return Response.json({ ok: true })
}
```
- Caveat: a visitor who already holds the page in their client cache can see old data for up to `stale` (5 min on every preset except `seconds`).
  - Lowering `stale` (custom profile, 30 s minimum) also drops that content from the App Shell.
  - Checkout must always re-read prices and stock on the server.

## 3. Route params
Sources: `03-api-reference/03-file-conventions/{page,layout,route,dynamic-routes}.md`, `03-api-reference/05-config/02-typescript.md`, `03-api-reference/04-functions/generate-static-params.md`, `02-guides/incremental-static-regeneration-cache-components.md`, `migrating-to-cache-components.md#generatestaticparams-and-dynamicparams`

- `params` and `searchParams` are **Promises**. Next 16 removed synchronous access entirely. The same applies to `cookies()`, `headers()`, `draftMode()`, the `params` of `opengraph-image` and `icon`, and the sitemap `id`.
- Global type helpers, no import needed (generated by `next dev`, `next build` and `next typegen`): `PageProps<'/[locale]/urun/[slug]'>`, `LayoutProps<'/[locale]'>` (includes `children` and named slots), `RouteContext<'/api/x/[id]'>`.
- **`generateStaticParams` with Cache Components:**
  - It must return **at least one** param. Returning `[]` is a build error (`empty-generate-static-params`).
  - Removing it opts the route out of ISR, so the route renders on every request.
  - A `dynamicParams` export breaks the build. Unlisted params render on request, so call `notFound()` for invalid ones.
- With Partial Prefetching, **await `params` inside `<Suspense>`**. Listed params produce fully static pages; unlisted ones get the App Shell instantly, then are upgraded in the background and cached (ISR). A child's `generateStaticParams` runs once per parent param set.
- A default `<Link>` prefetches only the App Shell. Use `<Link prefetch={true}>` to prefetch the param-specific content. This costs one server invocation per link.
- In a shared layout, `usePathname`, `useParams` and `useSelectedLayoutSegment(s)` suspend for dynamic routes, so wrap the component that reads them in Suspense. `useSearchParams` **always** needs Suspense.
```tsx
// src/app/[locale]/urun/[slug]/page.tsx
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
export async function generateStaticParams() {            // parent [locale] params come from the layout
  return (await getAllSlugs()).map((slug) => ({ slug }))  // must be ≥ 1 item
}
export default function Page({ params }: PageProps<'/[locale]/urun/[slug]'>) {
  return <Suspense fallback={<ProductSkeleton />}><Product params={params} /></Suspense>
}
async function Product({ params }: Pick<PageProps<'/[locale]/urun/[slug]'>, 'params'>) {
  const { locale, slug } = await params
  const product = await getProduct(locale, slug)          // "use cache" → static once known
  if (!product) notFound()
  return <ProductView product={product} />
}
```

## 4. `proxy.ts` (replaces `middleware.ts`)
Sources: `01-getting-started/16-proxy.md`, `03-api-reference/03-file-conventions/proxy.md`, `02-guides/upgrading/version-16.md#middleware-to-proxy`, `02-guides/authentication.md#optimistic-checks-with-proxy-optional`

- **Location:** `src/proxy.ts`, at the same level as `app/`. Only one is allowed per project, but it can import helper modules.
- **Exports:** `export function proxy(req: NextRequest)` (a default export also works) plus an optional `export const config = { matcher }`. `middleware.ts` and the `middleware` export are deprecated (codemod: `npx @next/codemod@canary middleware-to-proxy .`). `skipMiddlewareUrlNormalize` is now `skipProxyUrlNormalize`.
- **Runtime:** Node.js only, not configurable. A `runtime` export in this file throws. Edge apps must stay on `middleware`.
- **matcher:** must be static constants: a string, an array, or `{ source, has, missing, locale }` objects. Without a matcher, proxy runs on **everything**, including `_next/static`, `_next/image` and `public/` files. `_next/data` is matched even when excluded.
- **What it can do:** redirect, rewrite, read and set request and response headers and cookies (`req.cookies.get()`), respond directly, and run background work with `event.waitUntil()`.
- **What it should not do:** slow work or DB calls (it runs on every request, prefetches included). `fetch` cache options do nothing here, and `revalidateTag` / `revalidatePath` can't be called. It is **not** a security boundary: Server Actions are POSTs to the page route, so a matcher exclusion silently skips them. Authorize inside every action.
```ts
// src/proxy.ts (project): / → /tr, locale-less paths → /tr/…, optimistic /panel gate
import { NextResponse, type NextRequest } from 'next/server'
const LOCALES = ['tr', 'en', 'ar']
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (pathname.startsWith('/panel')) {                      // cookie presence only, no DB here
    if (pathname !== '/panel/giris' && !req.cookies.has('session'))
      return NextResponse.redirect(new URL('/panel/giris', req.url))
    return NextResponse.next()
  }
  if (LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`))) return
  req.nextUrl.pathname = `/tr${pathname === '/' ? '' : pathname}`
  return NextResponse.redirect(req.nextUrl)
}
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.png$|.*\\.jpg$|.*\\.webp$|.*\\.svg$).*)'],
}
```

## 5. Internationalization (`app/[locale]` as the root)
Sources: `02-guides/internationalization.md`, `03-api-reference/04-functions/next-root-params.md`, `03-api-reference/03-file-conventions/layout.md#root-layout`, `03-api-reference/03-file-conventions/not-found.md`, `migrating-to-cache-components.md#cookies-headers-and-searchparams`, `03-api-reference/02-components/script.md`

- Put **every** special file under `app/[locale]/` and make `app/[locale]/layout.tsx` the root layout (so delete `src/app/layout.tsx`). It must render `<html>` and `<body>`.
- With Cache Components, every root param needs `generateStaticParams` with at least one value, or the build fails.
- **`next/root-params`** (16.3+) provides `import { locale } from 'next/root-params'` and `await locale()`.
  - Works in Server Components, server utilities, `generateStaticParams` and inside `"use cache"`.
  - Does **not** work in Client Components, **Server Actions**, Route Handlers or `unstable_cache`. There, pass the locale explicitly, for example as a hidden input.
  - Segment names must be valid JavaScript identifiers.
- **Dictionaries:** use dynamic `import()` of per-locale JSON with a `hasLocale` type guard, and call `notFound()` for unknown locales. Translations stay on the server, out of the client bundle.
- **RTL:** the bundled docs say nothing about RTL (`rtl` and `dir=` don't appear anywhere).
  - Set `dir` the same way as `lang`, **from the route param**.
  - Never derive `lang`/`dir` from a cookie or header: an `<html>` attribute driven by a cookie or header makes the whole tree request-bound.
- Switching locale (`/tr` → `/ar`) is a client-side navigation because the root layout stays the same.
- If `/panel` lives outside `[locale]`, it needs its own root layout (`app/panel/layout.tsx`).
  - Moving between the two root layouts is a full page load.
  - `await locale()` is then typed `string | undefined`.
  - For a 404 on unmatched URLs, the docs suggest `experimental.globalNotFound: true` plus `app/global-not-found.tsx`.
```tsx
// src/app/[locale]/layout.tsx: the root layout
import '../globals.css'
export async function generateStaticParams() {
  return [{ locale: 'tr' }, { locale: 'en' }, { locale: 'ar' }]
}
export default async function RootLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params            // known at build time via generateStaticParams
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className={fontVars}>
      <body>{children}</body>
    </html>
  )
}
// src/i18n/get-dictionary.ts: no prop drilling
import { locale } from 'next/root-params'
import { notFound } from 'next/navigation'
const dictionaries = {
  tr: () => import('./tr.json').then((m) => m.default),
  en: () => import('./en.json').then((m) => m.default),
  ar: () => import('./ar.json').then((m) => m.default),
}
export const hasLocale = (l: string): l is keyof typeof dictionaries => l in dictionaries
export async function getDictionary() {
  const l = await locale()
  if (!hasLocale(l)) notFound()
  return dictionaries[l]()
}
```
After building, check the route table: `/tr`, `/en` and `/ar` should show as ○ (static) or ◐ (partial prerender).

## 6. Server Actions and forms
Sources: `01-getting-started/07-mutating-data.md`, `02-guides/forms.md`, `02-guides/server-actions.md`, `02-guides/authentication.md#server-actions`, `02-guides/authentication-with-cache-components.md`, `03-api-reference/05-config/01-next-config-js/serverActions.md`

- **Defining and calling:** write `'use server'` at the top of a file, or inline. Call the action from `<form action>` or `<button formAction>`, or from an event handler wrapped in `startTransition`.
- **Feedback:** `const [state, formAction, pending] = useActionState(action, initialState)` from `react`. The action signature then becomes `(prevState, formData)`.
  - `useFormStatus` from `react-dom` shows a pending state in a nested submit button.
  - `next/form` `<Form action="/ara">` is for GET search forms: it navigates with search params, client-side.
- **Validation:** validate on the server with zod, return `{ errors }`, and render them via `state`.
- **Security:** every action is a public POST endpoint.
  - Check the session and role inside **each** action, then validate input. A form that only appears on an authenticated page is not a boundary.
  - Accept IDs plus changes from the client, then re-read ownership from a trusted source. Return narrow data, not raw DB rows.
- **Built-in protections:** an Origin/Host CSRF check (`experimental.serverActions.allowedOrigins` for extra hosts), a 1 MB body limit (`experimental.serverActions.bodySizeLimit`; **(project)** image uploads will exceed it), and encrypted action IDs (set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` with multiple instances).
- **Sequencing:** the client dispatches actions one at a time, so never `Promise.all` several actions. Do the parallel work inside one action.
- **`redirect()` throws.** Call `updateTag` or `revalidatePath` *before* it. Setting a cookie inside an action re-renders the current page.
- **Route state persists:** with Cache Components, routes stay mounted (hidden by React `<Activity>`) when you navigate away. Form values and `useActionState` results survive navigation, so reset them yourself.
```tsx
'use client'
import { useActionState } from 'react'
import { saveProduct } from './actions'
export function ProductForm() {
  const [state, formAction, pending] = useActionState(saveProduct, { ok: false })
  return (<form action={formAction}>{/* inputs */}
    <p aria-live="polite">{state.ok ? 'Kaydedildi' : state.errors?.name}</p>
    <button disabled={pending}>Kaydet</button></form>)
}
```

## 7. `next/image`
Sources: `03-api-reference/02-components/image.md`, `02-guides/upgrading/version-16.md#nextimage-changes`

- **Defaults changed in 16:**
  - `qualities: [75]`. Any other `quality` is coerced to the nearest allowed value; a direct `/_next/image` request with an unlisted `q` returns 400.
  - `minimumCacheTTL: 14400` (4 h), `imageSizes` without 16, `maximumRedirects: 3`, local IPs blocked unless `dangerouslyAllowLocalIP`.
  - A local `src` with a query string needs `localPatterns[].search`. Once `localPatterns` is set, every other local path returns 400.
- `formats` defaults to `['image/webp']`. Use `['image/avif', 'image/webp']` to serve AVIF first. AVIF is about 50% slower to encode, and the two formats are cached separately.
- The `priority` prop is deprecated in favour of `preload` (or, in most cases, `loading="eager"` / `fetchPriority="high"`).
- `images.domains` is deprecated in favour of `remotePatterns` (objects or `new URL('https://…/**')`). `next/legacy/image` is deprecated.
- **There is no way to invalidate the optimized-image cache.** **(project)** When the admin replaces a product photo, store it under a new filename or URL.
```ts
images: {
  formats: ['image/avif', 'image/webp'],
  qualities: [60, 75, 90],
  remotePatterns: [{ protocol: 'https', hostname: 'cdn.example.com', pathname: '/prestij/**', search: '' }],
},
```

## 8. Fonts (`next/font/google`)
Sources: `01-getting-started/13-fonts.md`, `03-api-reference/02-components/font.md`. Subset lists were checked in `node_modules/next/dist/compiled/@next/font/dist/google/index.d.ts`.

- `subsets` controls what gets preloaded. If you leave it out while `preload` is true (the default), you get a warning. Non-variable fonts require `weight`. `display` defaults to `'swap'`.
- **(project)** Turkish ğ, ş, ı and İ are in **`latin-ext`**, so add it. The scaffolded layout uses only `latin`.
- **Latin fonts with no `arabic` subset:** Geist, Inter, Playfair_Display, Cormorant_Garamond.
- **Fonts with `arabic` + `latin` + `latin-ext`:** Cairo, Noto_Kufi_Arabic, Noto_Naskh_Arabic, IBM_Plex_Sans_Arabic, Amiri, Readex_Pro. Tajawal and Almarai have no `latin-ext`.
- A font called in the root layout is preloaded on **every** route. **(project)** Set `preload: false` on the Arabic font so `/tr` and `/en` don't preload it.
- **Tailwind 4:** apply `font.variable` on `<html>`, then map it in CSS with `@theme inline { --font-sans: var(--font-body); }`.
```ts
import { Cormorant_Garamond, Noto_Kufi_Arabic } from 'next/font/google'
const display = Cormorant_Garamond({ subsets: ['latin', 'latin-ext'], weight: ['400', '600'], variable: '--font-display' })
const arabic = Noto_Kufi_Arabic({ subsets: ['arabic'], variable: '--font-arabic', preload: false })
// <html className={`${display.variable} ${arabic.variable}`}>
```

## 9. Other traps for Next 14/15 developers
Sources: `02-guides/upgrading/version-16.md`, `03-api-reference/05-config/01-next-config-js/{cacheComponents,partialPrefetching}.md`, `02-guides/instant-navigation.md`, `01-getting-started/15-route-handlers.md`, `03-api-reference/04-functions/generate-metadata.md#with-cache-components`

- **Toolchain:** Node ≥ 20.9 and TypeScript ≥ 5.1. **Turbopack is the default** for `dev` and `build`: a custom `webpack` config fails the build (`--webpack` opts out), and `turbopack` is a top-level config key. `next dev` writes to `.next/dev`, so dev and build can run at once.
- **Removed:**
  - `next lint` (run `eslint` directly) and the `eslint` config key. AMP.
  - `serverRuntimeConfig` / `publicRuntimeConfig`: use env vars, with `await connection()` before a runtime read.
  - `experimental.ppr` / `dynamicIO` / `useCache`, and `unstable_rootParams` (use `next/root-params`).
- **Renamed:** `unstable_cacheLife` / `unstable_cacheTag` → `cacheLife` / `cacheTag`.
- **Routing:** every parallel-route slot needs a `default.tsx`. `scroll-behavior: smooth` is no longer overridden on navigation; add `data-scroll-behavior="smooth"` to `<html>` for the old behaviour.
- **`partialPrefetching: true`:** a default `<Link>` prefetches **one reusable App Shell per route** (the parts that don't depend on params or searchParams); routes reading cookies or headers get one per session. Requires `cacheComponents`. Both flags become the default next major.
- **Instant navigation:** dev checks that client navigations show UI immediately. A `<Suspense>` in the root layout does **not** cover a navigation below a shared layout, so place boundaries below the shared layout. Opt out with `instant = false`.
- **GET Route Handlers** are prerendered when they don't touch runtime or uncached data. `"use cache"` can't go on the `GET` export itself, so call a cached helper.
- **Metadata:** `generateMetadata` follows the same rules as components. On an otherwise-static page, reading uncached data in it is an error, so mark it `"use cache"` when the data doesn't depend on the request.
- **Persistence:** `use cache` entries don't survive a deploy. The `fetch` cache and `unstable_cache` do.
- **Agent tooling** (`02-guides/ai-agents.md`): `next dev` exposes an MCP endpoint at `/_next/mcp` (routes, logs, compilation issues). Error "Learn more" links point to per-error fix pages.
