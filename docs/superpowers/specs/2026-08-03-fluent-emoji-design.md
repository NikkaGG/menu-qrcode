# Fluent Emoji illustrations

## Goal

Add restrained Microsoft Fluent Emoji 3D illustrations to the customer QR menu and the administration panel. The illustrations should clarify loading, empty, error, success, confirmation, notification, and major section states without changing the existing monochrome visual system or crowding controls.

## Scope

The change covers:

- customer routes `/`, `/t/:token`, and `/order/:id`;
- administration routes `/admin`, `/admin/menu`, `/admin/tables`, and `/stats`;
- authentication, unknown admin routes, loading, empty, error, success, confirmation, and notification states;
- customer menu section headings and administration page headings.

Buttons, form labels, badges, table cells, and other small utility UI remain unchanged unless an icon is already part of the control.

## Asset policy

- Download only used PNG files from `github.com/microsoft/fluentui-emoji`.
- Use the 3D variant from `assets/<Emoji name>/3D/*.png`.
- Store assets in `public/emoji/` and serve them locally.
- Use short lowercase kebab-case filenames.
- Do not add Unicode emoji or use a third-party CDN.
- Preserve the upstream MIT license notice when required by the repository's licensing terms.

The intended semantic asset set is:

- `mobile-phone.png`
- `hourglass-not-done.png`
- `warning.png`
- `receipt.png`
- `party-popper.png`
- `magnifying-glass-tilted-left.png`
- `shopping-cart.png`
- `fire.png`
- `fork-and-knife-with-plate.png`
- `check-mark-button.png`
- `information.png`
- `locked.png`
- `bar-chart.png`
- `compass.png`
- `card-index-dividers.png`

Exact upstream paths must be verified before downloading. If Fluent Emoji uses a slightly different canonical asset name, the local semantic filename remains stable.

## Shared presentation

### Customer UI

Add a small HTML/JavaScript helper that returns decorative emoji `<img>` markup from a fixed allowlist. Dynamic state rendering must select a semantic variant rather than interpolate arbitrary paths.

CSS classes define three presentation sizes:

- state illustration: 56 px, centered above a state title, with 12–16 px bottom spacing;
- section illustration: 24–28 px, inline before a section heading;
- notification illustration: 22–24 px, inline before alert or toast text.

### Administration UI

Add a typed React `FluentEmoji` component. It accepts an allowlisted semantic name, size/presentation variant, and optional class name. It always emits fixed width and height.

Empty states use the existing `EmptyMedia` layout with the Fluent Emoji image replacing the Lucide placeholder. Page headings, alerts, confirmation dialogs, loading groups, and Sonner notifications use the same three visual sizes as the customer UI. `AdminShell` displays each route label in both the top bar and the content `<h1>`; only the content `<h1>` receives an emoji so each section has one visual accent.

### Accessibility

Every emoji in this change is decorative because adjacent visible text carries the same meaning. Every image therefore uses:

```html
<img alt="" aria-hidden="true">
```

Images have explicit dimensions to prevent layout shift. Existing live regions, alerts, dialog names, headings, focus behavior, and text remain the accessible source of meaning.

## Inventory and mapping

| Surface | Current text or state | Fluent Emoji | Placement and rationale |
|---|---|---|---|
| Customer client state | `Требуется QR-код` | Mobile phone | 56 px above the title; represents the phone used to scan the table QR code. |
| Customer client state | `Загружаем меню`, `Загружаем заказ` | Hourglass not done | 56 px above the title; consistent waiting state. |
| Customer client state | `Меню недоступно`, order refresh error | Warning | 56 px above the title; requires attention. |
| Customer order status | `Заказ: …` while active | Receipt | 56 px above the title; represents an existing order. |
| Customer order status | `Заказ готов. Приятного аппетита!` | Party popper | 56 px above the title; distinct final success state. |
| Customer search | `Ничего не найдено` | Magnifying glass tilted left | 56 px above the empty result title. |
| Customer cart | `Корзина пуста` | Shopping cart | 56 px above the empty cart title. |
| Customer popular section | `Популярное` | Fire | 24 px before the heading; denotes popularity. |
| Customer category sections | Dynamic category names | Fork and knife with plate | 24 px before each same-purpose category heading. |
| Customer unavailable confirmation | `Некоторые блюда недоступны` | Warning | 24 px beside the confirmation heading. |
| Customer cart warning | Unavailable dishes or submission error | Warning | 22–24 px beside warning text. |
| Customer toasts | Success, error, and informational messages | Check mark button, Warning, Information | 22–24 px selected by an explicit toast variant. |
| Admin session gate | `Проверяем сессию…` | Hourglass not done | 56 px above loading text. |
| Admin login | `Вход в панель управления` | Locked | 56 px above the form heading. |
| Admin shell heading | `Управление меню` | Fork and knife with plate | 28 px before the page heading. |
| Admin shell content heading | `Столы и QR-коды` | Mobile phone | 28 px before the content `<h1>`; represents QR scanning without duplicating the top-bar label. |
| Admin shell heading | `Статистика` | Bar chart | 28 px before the page heading. |
| Admin unknown route | `Запрошенная страница не существует` | Compass | 56 px above the message. |
| Menu administration | Initial skeleton group | Hourglass not done | One 48–56 px image above the complete loading group. |
| Menu administration | `Меню не загружено`, availability error | Warning | 24 px beside the alert title. |
| Menu administration | `Категорий пока нет` | Card index dividers | 56 px above the empty title; represents an empty catalog structure. |
| Category administration | `В этой категории пока нет блюд` | Fork and knife with plate | 48–56 px above the empty title. |
| Tables administration | Initial loading card | Hourglass not done | One 48–56 px image above the complete loading card. |
| Tables administration | `Столы не загружены` | Warning | 24 px beside the alert title. |
| Tables administration | `Столов пока нет` | Mobile phone | 56 px above the empty title; represents the QR-based table flow. |
| Statistics administration | Initial loading group | Hourglass not done | One 48–56 px image above the complete loading group. |
| Statistics administration | `Статистику загрузить не удалось` | Warning | 24 px beside the alert title. |
| Statistics administration | `За выбранный период статистики нет` | Bar chart | 56 px above the empty title. |
| Statistics administration | `Прибыль недоступна` | Information | 24 px beside the explanatory alert title. |
| Admin delete confirmations | Delete category, dish, or table | Warning | 24 px beside the confirmation title. |
| Admin Sonner notifications | Created, updated, deleted, downloaded, or failed | Check mark button or Warning | 22–24 px selected from notification type. |

Repeating an emoji is allowed only when the repeated surfaces express the same meaning, such as Warning for actionable failures or Hourglass for loading.

## Dynamic state behavior

The customer client-state image changes whenever the title/status changes:

- QR required → Mobile phone;
- loading → Hourglass not done;
- unavailable/error → Warning;
- active order → Receipt;
- ready order → Party popper.

The customer toast API gains a semantic variant (`success`, `error`, or `info`) while keeping message text unchanged. Existing call sites are classified explicitly.

Administration content `<h1>` headings map route types to a fixed emoji. The duplicate compact route label in the top bar remains text-only. Unknown routes use Compass in the body and do not invent a route heading mapping.

## Error handling

- Emoji assets are present at build time and require no runtime network request to third parties.
- Missing images must not hide or replace state text.
- Asset paths are constants or allowlisted values, not user-controlled.
- Existing API errors and retry actions remain unchanged.
- Existing loading skeletons remain visible, so slow image decoding never removes loading feedback.

## Testing and validation

Follow test-driven development:

1. Add failing customer contract tests for local asset paths, decorative attributes, state mappings, toast variants, and synchronized `index.html`/`menu.html`.
2. Add failing data-driven React tests for every administration mapping in the inventory, including all headings, loading/empty/error states, dialogs, notifications, and state transitions.
3. Implement the minimum code required to pass.
4. Run focused tests, then `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
5. Run browser checks at mobile and desktop widths for the customer states and all admin routes.
6. Confirm no Unicode emoji were introduced and every referenced file exists under `public/emoji/`.

## Acceptance criteria

- Every inventory row has one appropriate Fluent Emoji illustration.
- No Unicode emoji or remote emoji URLs are used.
- Only used 3D PNG assets are checked in under `public/emoji/`.
- Decorative images use empty alt text and `aria-hidden="true"`.
- Empty/loading state images are approximately 48–64 px; inline images are approximately 20–28 px.
- Similar states use consistent alignment and spacing.
- The existing white, minimal interface remains visually dominant.
- Customer and administration tests, type checks, lint, build, and browser checks pass.
