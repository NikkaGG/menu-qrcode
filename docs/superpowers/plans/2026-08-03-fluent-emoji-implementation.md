# Fluent Emoji Illustrations Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if droids available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add locally hosted Microsoft Fluent Emoji 3D illustrations to every approved customer and administration state without weakening accessibility or the current minimal design.

**Architecture:** A fixed set of PNG assets lives under root `public/emoji/`. The React administration app uses one typed `FluentEmoji` component and route/state mappings; the legacy customer document uses one allowlisted HTML helper plus three shared CSS presentation classes. Tests treat the approved inventory as a contract and keep `index.html` and `menu.html` byte-identical.

**Tech Stack:** Static HTML/CSS/JavaScript, React 19, TypeScript, Vite, Tailwind CSS, Vitest, Testing Library, Node test runner, Playwright.

**Specification:** `docs/superpowers/specs/2026-08-03-fluent-emoji-design.md`

---

## File structure

**Create**

- `public/emoji/*.png`: only the approved Fluent Emoji 3D PNG files.
- `public/emoji/LICENSE`: upstream Microsoft Fluent Emoji MIT license.
- `tests/fluent-emoji-assets.test.js`: asset existence, PNG signature, local-reference, and Unicode-emoji contracts.
- `admin-app/src/components/fluent-emoji.tsx`: typed asset map and decorative image component.
- `admin-app/src/components/fluent-emoji.test.tsx`: component path, size, and accessibility tests.
- `admin-app/src/components/ui/sonner.test.tsx`: notification-slot mapping tests.

**Modify**

- `index.html`: customer helper, state mapping, toast variants, markup, and shared CSS.
- `menu.html`: byte-identical copy of `index.html`.
- `tests/regression.test.js`: customer dynamic illustration and toast tests.
- `tests/stage03-client-ordering.test.js`: customer static state and local asset contract.
- `admin-app/src/App.tsx`: illustrated unknown-route state.
- `admin-app/src/components/session-gate.tsx`: illustrated session loading.
- `admin-app/src/components/login-form.tsx`: illustrated login heading and login error.
- `admin-app/src/components/admin-shell.tsx`: route-to-emoji mapping on the content `<h1>` only.
- `admin-app/src/components/ui/sonner.tsx`: Fluent Emoji notification icons.
- `admin-app/vite.config.ts`: preview-only serving for root `/public/emoji/` assets.
- `admin-app/tests/fluent-emoji-assets.spec.ts`: HTTP availability of every administration emoji in Vite preview.
- `admin-app/src/features/menu/menu-page.tsx`: menu loading, error, and empty states.
- `admin-app/src/features/menu/category-section.tsx`: empty category and delete confirmation.
- `admin-app/src/features/menu/dish-row.tsx`: delete confirmation/error.
- `admin-app/src/features/tables/tables-page.tsx`: tables loading, error, and empty states.
- `admin-app/src/features/tables/table-row.tsx`: delete confirmation/error.
- `admin-app/src/features/stats/stats-page.tsx`: statistics loading, error, informational, and empty states.
- Existing adjacent `*.test.tsx` files: data-driven coverage of every administration mapping.

## Chunk 1: Local assets and shared React primitive

### Task 1: Lock the local asset contract

**Files:**
- Create: `tests/fluent-emoji-assets.test.js`
- Create: `public/emoji/LICENSE`
- Create: `public/emoji/*.png`
- Reference: `docs/superpowers/specs/2026-08-03-fluent-emoji-design.md`

- [ ] **Step 1: Write the failing asset contract**

Create a Node test with the approved local filenames:

```js
const ASSETS = [
  "mobile-phone.png",
  "hourglass-not-done.png",
  "warning.png",
  "receipt.png",
  "party-popper.png",
  "magnifying-glass-tilted-left.png",
  "shopping-cart.png",
  "fire.png",
  "fork-and-knife-with-plate.png",
  "check-mark-button.png",
  "information.png",
  "locked.png",
  "bar-chart.png",
  "compass.png",
  "card-index-dividers.png",
];
```

For every asset, assert that it is a file and begins with the PNG signature `89504e470d0a1a0a`. Assert that `public/emoji/LICENSE` contains `MIT License`. Also assert:

- the directory contains exactly the 15 approved PNG filenames, with no extras;
- every `/public/emoji/*.png` reference in customer and administration source resolves to an approved file;
- no UI source references `raw.githubusercontent.com`, `github.com/microsoft/fluentui-emoji`, or another remote emoji URL;
- no pictographic Unicode is introduced in changed UI source (use an explicit forbidden-code-point regex, excluding ordinary Cyrillic and punctuation).

- [ ] **Step 2: Run the asset test and verify it fails**

Run:

```powershell
node --test tests/fluent-emoji-assets.test.js
```

Expected: FAIL because `public/emoji/` and its files do not exist.

- [ ] **Step 3: Resolve every canonical upstream path**

Use the GitHub repository tree for `microsoft/fluentui-emoji` and verify each source is under:

```text
assets/<Canonical name>/3D/<normalized_name>_3d.png
```

Use `Mobile phone`, not the nonexistent `Qr code`. Record each exact percent-encoded source URL in an `ASSET_SOURCES` object in the test so provenance remains auditable. Verify every URL manually in the repository browser before downloading.

- [ ] **Step 4: Download only the approved assets and license**

Create `public/emoji/`, then download each verified URL with PowerShell:

```powershell
New-Item -ItemType Directory -Force -Path 'public/emoji' | Out-Null
$sources = @{
  'mobile-phone.png' = 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Mobile%20phone/3D/mobile_phone_3d.png'
  # Continue with every URL verified in ASSET_SOURCES.
}
foreach ($entry in $sources.GetEnumerator()) {
  $output = Join-Path 'public/emoji' $entry.Key
  try {
    Invoke-WebRequest -Uri $entry.Value -OutFile $output -ErrorAction Stop
  } catch {
    throw "Failed to download $($entry.Key)"
  }
  if (-not (Test-Path -LiteralPath $output)) { throw "Missing downloaded file $($entry.Key)" }
}
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/LICENSE' -OutFile 'public/emoji/LICENSE' -ErrorAction Stop
```

Do not download animated, color, flat, high contrast, or metadata variants.

- [ ] **Step 5: Run the asset test and verify it passes**

Run:

```powershell
node --test tests/fluent-emoji-assets.test.js
```

Expected: PASS, 15 valid local PNG files and the MIT license.

- [ ] **Step 6: Commit local assets and their contract**

```powershell
git add tests/fluent-emoji-assets.test.js public/emoji
git commit -m "feat: add local Fluent Emoji assets"
```

### Task 2: Build the typed administration primitive

**Files:**
- Create: `admin-app/src/components/fluent-emoji.tsx`
- Create: `admin-app/src/components/fluent-emoji.test.tsx`

- [ ] **Step 1: Write failing component tests**

Test every semantic name with `it.each`. For representative sizes, assert:

```tsx
const { container } = render(<FluentEmoji name="warning" size="inline" />);
const image = container.querySelector("img");
expect(image).not.toBeNull();
expect(image).toHaveAttribute("src", "/public/emoji/warning.png");
expect(image).toHaveAttribute("alt", "");
expect(image).toHaveAttribute("aria-hidden", "true");
expect(image).toHaveAttribute("width", "24");
expect(image).toHaveAttribute("height", "24");
```

Also test `state` → 56 and `heading` → 28.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npx vitest run --config admin-app/vitest.config.ts admin-app/src/components/fluent-emoji.test.tsx
```

Expected: FAIL because `FluentEmoji` does not exist.

- [ ] **Step 3: Implement the minimal typed component**

Create a readonly filename map and prevent arbitrary paths:

```tsx
const files = {
  "mobile-phone": "mobile-phone.png",
  warning: "warning.png",
  // all approved names
} as const;

const sizes = { inline: 24, heading: 28, state: 56 } as const;

export function FluentEmoji({ name, size = "inline", className }: Props) {
  const pixels = sizes[size];
  return (
    <img
      src={`/public/emoji/${files[name]}`}
      alt=""
      aria-hidden="true"
      width={pixels}
      height={pixels}
      className={cn("inline-block shrink-0 object-contain", className)}
    />
  );
}
```

- [ ] **Step 4: Run focused component and accessibility tests**

Run:

```powershell
npx vitest run --config admin-app/vitest.config.ts admin-app/src/components/fluent-emoji.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the primitive**

```powershell
git add admin-app/src/components/fluent-emoji.tsx admin-app/src/components/fluent-emoji.test.tsx
git commit -m "feat: add Fluent Emoji component"
```

## Chunk 2: Administration states

### Task 3: Illustrate global administration surfaces

**Files:**
- Modify: `admin-app/src/App.tsx`
- Modify: `admin-app/src/main.test.tsx`
- Modify: `admin-app/src/components/session-gate.tsx`
- Modify: `admin-app/src/components/session-gate.test.tsx`
- Modify: `admin-app/src/components/login-form.tsx`
- Modify: `admin-app/src/components/session-gate.test.tsx`
- Modify: `admin-app/src/components/admin-shell.tsx`
- Modify: `admin-app/src/components/admin-shell.test.tsx`
- Modify: `admin-app/src/components/ui/sonner.tsx`
- Create: `admin-app/src/components/ui/sonner.test.tsx`
- Modify: `admin-app/vite.config.ts`
- Create: `admin-app/tests/fluent-emoji-assets.spec.ts`

- [ ] **Step 1: Add failing data-driven tests**

Cover:

- session loading → `hourglass-not-done`, 56 px;
- login heading → `locked`, 56 px;
- login error → `warning`, 24 px;
- content `<h1>` mappings: menu → `fork-and-knife-with-plate`, tables → `mobile-phone`, stats → `bar-chart`, each 28 px;
- top-bar duplicate route label contains no emoji;
- unknown route → `compass`, 56 px;
- Sonner success/info/warning/error/loading slots → `check-mark-button`, `information`, `warning`, `warning`, `hourglass-not-done`.

For every state, assert the exact image count and placement relative to its title. No state/card/heading may receive more than one illustration.

- [ ] **Step 2: Run the focused tests and verify failures**

Run:

```powershell
npx vitest run --config admin-app/vitest.config.ts admin-app/src/main.test.tsx admin-app/src/components/session-gate.test.tsx admin-app/src/components/admin-shell.test.tsx admin-app/src/components/ui/sonner.test.tsx
```

Expected: FAIL on missing decorative images.

- [ ] **Step 3: Implement global mappings**

Use `FluentEmoji` beside text, never instead of it. In `AdminShell`, wrap only the content `<h1>` contents in an inline flex container. Keep the top header unchanged.

Replace Lucide icons only inside Sonner's notification icon map. Keep Lucide navigation and button icons.

- [ ] **Step 4: Serve root emoji assets in Vite preview**

Add a preview middleware in `admin-app/vite.config.ts` before the SPA fallback. It handles only normalized requests matching `/public/emoji/<approved-filename>`, reads from repository-root `public/emoji`, rejects traversal, sets `image/png`, and returns 404 for unknown names. This is test infrastructure only; production continues to serve the root directory through Vercel.

Add `admin-app/tests/fluent-emoji-assets.spec.ts` that requests every approved `/public/emoji/*.png` path through Playwright's `request` fixture and asserts HTTP 200 plus `content-type: image/png`.

- [ ] **Step 5: Run focused tests and existing axe checks**

Run the command from Step 2.

Then run:

```powershell
npx playwright test --config admin-app/playwright.config.ts admin-app/tests/fluent-emoji-assets.spec.ts
```

Expected: PASS. Existing `AdminShell` axe coverage remains green.

- [ ] **Step 6: Commit global administration surfaces**

```powershell
git add admin-app/src/App.tsx admin-app/src/main.test.tsx admin-app/src/components/session-gate.tsx admin-app/src/components/session-gate.test.tsx admin-app/src/components/login-form.tsx admin-app/src/components/admin-shell.tsx admin-app/src/components/admin-shell.test.tsx admin-app/src/components/ui/sonner.tsx admin-app/src/components/ui/sonner.test.tsx admin-app/vite.config.ts admin-app/tests/fluent-emoji-assets.spec.ts
git commit -m "feat: illustrate admin shell states"
```

### Task 4: Illustrate menu administration states

**Files:**
- Modify: `admin-app/src/features/menu/menu-page.tsx`
- Modify: `admin-app/src/features/menu/menu-page.test.tsx`
- Modify: `admin-app/src/features/menu/category-section.tsx`
- Modify: `admin-app/src/features/menu/dish-row.tsx`
- Modify: `admin-app/src/features/menu/menu-async-children.test.tsx`

- [ ] **Step 1: Add failing inventory tests**

Cover:

- one `hourglass-not-done` above the initial skeleton group;
- `warning` in load and availability alerts;
- `card-index-dividers` in the no-categories empty state;
- `fork-and-knife-with-plate` in each empty category;
- `warning` in category and dish delete confirmations and delete errors;
- success/error toasts retain their text and use the shared Sonner images.

For each rendered loading block, empty card, alert, and dialog, assert exactly one illustration and assert it precedes or sits beside the matching title.

- [ ] **Step 2: Run the focused tests and verify failures**

Run:

```powershell
npx vitest run --config admin-app/vitest.config.ts admin-app/src/features/menu/menu-page.test.tsx admin-app/src/features/menu/menu-async-children.test.tsx
```

Expected: FAIL on missing inventory illustrations.

- [ ] **Step 3: Implement menu illustrations**

Use one centered state image per loading/empty block and one inline image per alert/dialog title. Replace current empty-state Lucide media with `FluentEmoji`; do not add images to action buttons or dish rows.

- [ ] **Step 4: Run focused tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit menu administration states**

```powershell
git add admin-app/src/features/menu/menu-page.tsx admin-app/src/features/menu/menu-page.test.tsx admin-app/src/features/menu/category-section.tsx admin-app/src/features/menu/dish-row.tsx admin-app/src/features/menu/menu-async-children.test.tsx
git commit -m "feat: illustrate admin menu states"
```

### Task 5: Illustrate tables and statistics states

**Files:**
- Modify: `admin-app/src/features/tables/tables-page.tsx`
- Modify: `admin-app/src/features/tables/tables-page.test.tsx`
- Modify: `admin-app/src/features/tables/table-row.tsx`
- Modify: `admin-app/src/features/stats/stats-page.tsx`
- Modify: `admin-app/src/features/stats/stats-page.test.tsx`

- [ ] **Step 1: Add failing tables inventory tests**

Cover initial loading → `hourglass-not-done`, load error → `warning`, empty tables → `mobile-phone`, and delete confirmation/error → `warning`.

Assert exactly one image in each rendered loading card, empty state, alert, and dialog and verify title-relative placement.

- [ ] **Step 2: Add failing statistics inventory tests**

Cover initial loading → `hourglass-not-done`, load error → `warning`, no statistics → `bar-chart`, and unavailable profit → `information`.

Assert exactly one image in each rendered loading group, empty state, and alert and verify title-relative placement.

- [ ] **Step 3: Run focused tests and verify failures**

Run:

```powershell
npx vitest run --config admin-app/vitest.config.ts admin-app/src/features/tables/tables-page.test.tsx admin-app/src/features/stats/stats-page.test.tsx
```

Expected: FAIL on missing inventory illustrations.

- [ ] **Step 4: Implement tables and statistics illustrations**

Preserve existing skeletons, alerts, buttons, responsive table behavior, and chart fallback. Add exactly one image to each approved state.

- [ ] **Step 5: Run focused tests**

Run the command from Step 3.

Expected: PASS.

- [ ] **Step 6: Commit tables and statistics states**

```powershell
git add admin-app/src/features/tables/tables-page.tsx admin-app/src/features/tables/tables-page.test.tsx admin-app/src/features/tables/table-row.tsx admin-app/src/features/stats/stats-page.tsx admin-app/src/features/stats/stats-page.test.tsx
git commit -m "feat: illustrate admin data states"
```

## Chunk 3: Customer menu states

### Task 6: Add the customer illustration helper and customer state harnesses

**Files:**
- Modify: `tests/stage03-client-ordering.test.js`
- Modify: `index.html`
- Modify: `menu.html`

- [ ] **Step 1: Add failing customer markup and behavioral tests**

Assert:

- a client-state image exists before `clientStateTitle`;
- all customer image paths begin `/public/emoji/`;
- every decorative image has `alt=""` and `aria-hidden="true"`;
- popular heading uses `fire`;
- category heading rendering uses `fork-and-knife-with-plate`;
- empty search uses `magnifying-glass-tilted-left`;
- empty cart uses `shopping-cart`;
- unavailable confirmation and cart warning use `warning`;
- state, section, and notification CSS sizes are in approved ranges.

Use source assertions only for fixed HTML placement and CSS. For runtime-generated category headings, empty search/cart, and warnings, execute the relevant extracted function in the existing VM/minimal-DOM harness. Assert the emitted DOM contains exactly one image, the approved local path, explicit dimensions, `alt=""`, `aria-hidden="true"`, and image-before-title/text ordering.

- [ ] **Step 2: Run the focused test and verify failures**

Run:

```powershell
node --test tests/stage03-client-ordering.test.js
```

Expected: FAIL on missing customer illustrations and runtime mappings.

- [ ] **Step 3: Add allowlisted customer helpers**

Add:

```js
const FLUENT_EMOJI_FILES = Object.freeze({
  mobilePhone: 'mobile-phone.png',
  warning: 'warning.png',
  // approved customer subset
});

function emojiImg(name, className = 'emoji-inline') {
  const file = FLUENT_EMOJI_FILES[name];
  if (!file) return '';
  return `<img class="${className}" src="/public/emoji/${file}" alt="" aria-hidden="true" width="24" height="24">`;
}
```

For the fixed client-state node, prefer setting `src`, `width`, and `height` on a pre-existing `<img>` rather than replacing the whole card.

- [ ] **Step 4: Add shared CSS and static illustrations**

Define centered 56 px state, 24–28 px section, and 22–24 px notification classes. Keep text layout and the white palette unchanged.

- [ ] **Step 5: Synchronize the customer documents**

Copy the completed `index.html` bytes to `menu.html`; do not hand-edit the duplicate independently.

- [ ] **Step 6: Run customer static and identity tests**

Run:

```powershell
node --test tests/stage03-client-ordering.test.js tests/regression.test.js
```

Expected: PASS, including behavioral DOM assertions and byte identity.

- [ ] **Step 7: Commit static customer illustrations**

```powershell
git add index.html menu.html tests/stage03-client-ordering.test.js
git commit -m "feat: illustrate customer menu states"
```

### Task 7: Map dynamic customer states and toast variants

**Files:**
- Modify: `tests/regression.test.js`
- Modify: `index.html`
- Modify: `menu.html`

- [ ] **Step 1: Add failing state-mapping tests**

Exercise extracted functions and assert:

- `showQrRequired()` → `mobile-phone`;
- loading menu/order → `hourglass-not-done`;
- menu/order error → `warning`;
- active order → `receipt`;
- ready order → `party-popper`.

Use a minimal DOM harness with `clientStateEmoji`, `clientStateTitle`, and existing text nodes. Assert exactly one state image remains after repeated transitions.

- [ ] **Step 2: Add failing toast-variant tests**

Change the expected API to:

```js
showToast("Ссылка скопирована", "success");
showToast("Не удалось отправить заказ", "error");
showToast("Открываем карту", "info");
```

Assert that the toast contains a decorative 24 px image plus unchanged message text. Classify every current call site explicitly; default remains `info` for compatibility.

- [ ] **Step 3: Run regression tests and verify failures**

Run:

```powershell
node --test tests/regression.test.js
```

Expected: FAIL because state images and toast variants are not implemented.

- [ ] **Step 4: Implement dynamic mappings**

Extend `showClientState` with an emoji semantic argument and add a helper that safely updates the fixed image. In `renderOrderStatus`, choose `partyPopper` only for `ready`, otherwise `receipt`. On polling error, switch to `warning` while retaining the error text.

- [ ] **Step 5: Implement structured toast content**

Use DOM methods (`replaceChildren`, `createElement`, `textContent`) rather than interpolating message strings into HTML. This preserves XSS safety.

- [ ] **Step 6: Synchronize `menu.html` and run focused tests**

Run:

```powershell
Copy-Item -LiteralPath index.html -Destination menu.html
node --test tests/regression.test.js tests/stage03-client-ordering.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit dynamic customer behavior**

```powershell
git add index.html menu.html tests/regression.test.js
git commit -m "feat: map customer state illustrations"
```

## Chunk 4: Full validation

### Task 8: Run repository checks and inspect every surface

**Files:**
- Modify only if a check reveals an in-scope defect.

- [ ] **Step 1: Run automated Unicode, remote-reference, and asset-reference checks**

Run:

```powershell
node --test tests/fluent-emoji-assets.test.js
```

Expected: PASS for the exact asset set, PNG signatures, local references, no remote UI references, and no pictographic Unicode in changed UI source.

- [ ] **Step 2: Run all automated checks**

Run in order:

```powershell
npm run test:contract
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all exit 0. Fix in-scope failures using the systematic-debugging skill and rerun the failing command before continuing.

- [ ] **Step 3: Run browser tests**

Run:

```powershell
npm run test:browser
```

Expected: all browser and accessibility tests pass.

- [ ] **Step 4: Start a customer static server**

Start a temporary local server in the repository root:

```powershell
$server = Start-Process -FilePath 'py' -ArgumentList '-m','http.server','4174','--bind','127.0.0.1','--directory','C:\Users\STARLINECOMP\Desktop\menu-qrcode\menu' -PassThru
```

Navigate to `http://127.0.0.1:4174/index.html`. Use browser evaluation to invoke the already-tested customer render/state functions for states that normally require `/t/:token`, `/order/:id`, or API responses. Always stop the process afterward:

```powershell
Stop-Process -Id $server.Id
```

- [ ] **Step 5: Perform visual checks at mobile and desktop widths**

Use a local isolated browser to inspect:

- customer QR-required, menu-loading, unavailable, empty search, empty cart, active order, ready order, warning, and toast variants;
- admin session/loading, login, unknown route, every page heading, each loading/empty/error state, delete confirmations, and Sonner notifications;
- both customer cart-warning forms (pre-submit review and post-submit race fallback);
- admin notifications for created, updated, deleted, QR downloaded, and failed operations;
- widths 320–390 px and 1280–1440 px.

Confirm one emoji per card/section, no clipping, no duplicate admin heading emoji, no layout shift, and no loss of text or focus semantics.

- [ ] **Step 6: Verify asset references and final diff**

For every `/public/emoji/*.png` reference, assert the file exists. Review `git diff --check`, `git status --short`, and the full diff. Do not stage or alter the user's unrelated untracked audit screenshots.

- [ ] **Step 7: Request code review**

Invoke the requesting-code-review skill, address high-confidence findings, and rerun affected checks.

- [ ] **Step 8: Run fresh completion verification**

Invoke the verification-before-completion skill and rerun the final required commands fresh before claiming success.

- [ ] **Step 9: Prepare the requested outcome table**

Report:

```text
File/component | Place | Before | After (emoji and local file) | Rationale
```

Include every approved inventory row and list validation commands with their actual outcomes.
