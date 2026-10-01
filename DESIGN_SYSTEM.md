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

Kitchen, floor and administrator screens share `/ops.css`.

Page scopes:
- `body.ops.ops-kitchen`
- `body.ops.ops-staff`
- `body.ops.ops-admin`

The operations interface deliberately uses the same visual family as the guest menu without copying the legacy guest CSS cascade.

### Tokens

Core tokens live in `:root` inside `ops.css`:
- surfaces: `--ops-bg`, `--ops-surface`, `--ops-surface-soft`
- text: `--ops-text`, `--ops-muted`, `--ops-faint`
- borders: `--ops-line`, `--ops-line-strong`
- semantic states: danger, warning, success
- radii: small through extra-large
- shadows and focus ring
- shell width

### Interaction rules

- Minimum primary touch target: 44px.
- Critical/destructive actions use the danger treatment, never the primary black treatment.
- Ready/success states use the restrained green semantic token.
- Guest requests and comments use warm warning surfaces.
- Keyboard focus must remain visible.
- Reduced-motion preference is respected.
- Mobile screens collapse multi-column workspaces into a single readable flow.

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

## 3. Change rule

If a future change touches both guest and operations UI, keep the implementations separate:
- guest visual changes belong to the guest CSS/app
- staff/admin changes belong to `ops.css`

A shared token should only move into a common layer if doing so can be proven not to alter the guest menu rendering.
