# Sushi Crazy UI system

## 1. Guest menu: visual contract

The current guest menu is the visual reference and must not be redesigned implicitly.

Protected surfaces:
- `index.html`
- `styles.css`
- guest menu and cart rendering in `app.js`

Preserve unless the product owner explicitly requests a visual change:
- black / white / soft-gray palette
- SF Pro typography and current type hierarchy
- product-card proportions and image treatment
- current grid/list presentation
- popular section presentation
- sticky search/category bar
- product sheet, cart sheet, restaurant footer
- current radius, spacing, shadows and general density

Allowed without a visual redesign:
- bug fixes
- accessibility fixes that do not materially change appearance
- layout overflow fixes
- resilient media loading
- cache/runtime fixes
- internal refactoring that produces equivalent rendering

Do not use the guest menu as a playground for operations UI changes.

## 2. Operations UI

Kitchen, floor and administrator screens share `/ops.css` and `/ops-ui.js`.

The October 2026 redesign follows the installed `design-taste-frontend` (taste-skill): audit first, one visual language, restrained motion, clear hierarchy and tested responsive states. For a restaurant workspace the working values are DESIGN_VARIANCE 3, MOTION_INTENSITY 2 and VISUAL_DENSITY 7.

Page scopes:
- `body.ops.ops-kitchen`
- `body.ops.ops-staff`
- `body.ops.ops-admin`

The operations interface shares the guest menu's locally hosted SF Pro type family and black/white palette. All interface colors are achromatic, including shadows, focus rings, charts and both system themes. Food photography retains its natural colors. There is one stylesheet, without accumulated experimental overrides.

### Tokens

Core tokens live in `:root` inside `ops.css`:
- surfaces: `--ops-bg`, `--ops-surface`, `--ops-surface-soft`
- text: `--ops-text`, `--ops-muted`, `--ops-faint`
- borders: `--ops-line`, `--ops-line-strong`
- semantic states: danger, warning, success
- radii: 4px for status labels, 6px for controls, 8px for cards and dialogs
- shadows and focus ring
- shell width

### Interaction rules

- Minimum touch target: 44px.
- Primary operations use black with white text in light mode, and white with black text in dark mode.
- Status information remains explicit in labels. Ready badges use high contrast; cancelled/stop badges have an outline; working lanes and waiting warnings use dashed borders.
- Guest requests and comments use neutral surfaces with a contrasting edge.
- Keyboard focus must remain visible.
- Reduced-motion preference is respected.
- Mobile screens collapse multi-column workspaces into a single readable flow.
- Admin uses a fixed bottom navigation on phones; dialogs appear above it.
- Kitchen lanes are unframed; only individual orders are cards.
- Summary metrics are divided rows, not nested cards.
- Themes follow the system preference and use the same semantic tokens.
- Dialogs lock background scrolling, trap keyboard focus and return focus to the opener.
- Saving blocks duplicate submission and accidental dismissal; form errors stay next to the form.
- Expanded floor orders and keyboard focus survive polling updates.
- Category filters scroll inside their row without expanding the page.
- Icon tools use local Lucide 0.468.0, with accessible names and tooltips.

### Component families

Shared:
- top navigation
- login card
- stats
- cards
- badges
- action groups
- empty states
- modal / QR modal
- toast

Admin:
- analytics cards
- chart
- payment meters
- table management cards

Kitchen:
- order lanes
- order cards
- order progression actions

Floor:
- guest requests
- table sessions
- order status rows
- expandable order contents and comments
- explicit explanations for tables that cannot yet be closed

## 3. Change rule

If a future change touches both guest and operations UI, keep the implementations separate:
- guest visual changes belong to the guest CSS/app
- staff/admin changes belong to `ops.css`

A shared token should only move into a common layer if doing so can be proven not to alter the guest menu rendering.

## 4. Local verification

Run `npm install`, then `npm run dev`. The preview binds only to `127.0.0.1:4173`. Set `MENU_DEV_PORT` to choose another port. Admin PIN is `1`; the isolated staff PIN is `1234`.

`scripts/dev-server.cjs` executes the production TypeScript handlers against in-memory data. It rewrites the backend origin only in locally served responses. It never contacts or modifies the remote restaurant database. Data resets when the server restarts.

Run `npm test` for restaurant calendar boundary tests and `npm run test:browser` for browser verification against the running preview. The browser suite uses installed Chrome; `CHROME_PATH` can override its path. Screenshots and results are written to ignored `artifacts/ui-audit/`.

Run `npm run test:controls` separately for QR clipboard/download/open actions, staff authentication and mutation failure/retry flows. Both browser suites reset the isolated fixture, so run them sequentially. See `UI_UX_AUDIT.md` for the audit findings and verification boundaries.

Run `npm run test:palette` to check computed interface colors, borders, shadows, pseudo-elements and hovered/focused controls on every operations screen in both themes at desktop/mobile sizes. Raster food photographs are intentionally not desaturated.

The legacy regression suite predates the extracted `app.js`, external stylesheet and QR-only checkout. Its initial baseline was 7 passing and 70 failing tests. Keep that baseline separate from the current operations checks until the old suite is migrated.
