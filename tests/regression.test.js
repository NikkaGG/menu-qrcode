const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const menuSource = fs.readFileSync(path.join(root, 'menu.html'), 'utf8');
const adminSource = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const adminApiSource = fs.readFileSync(path.join(root, 'supabase/functions/admin-api/index.ts'), 'utf8');
const opsCssSource = fs.readFileSync(path.join(root, 'ops.css'), 'utf8');
const staffOrdersSource = fs.readFileSync(path.join(root, 'supabase/functions/staff-orders/index.ts'), 'utf8');
const kitchenSource = fs.readFileSync(path.join(root, 'kitchen.html'), 'utf8');
const staffSource = fs.readFileSync(path.join(root, 'staff.html'), 'utf8');
const roleAccessMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261002071000_role_access.sql'), 'utf8');
const statusEventsMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261002072000_order_status_events.sql'), 'utf8');
const tableApiSource = fs.readFileSync(path.join(root, 'supabase/functions/table-api/index.ts'), 'utf8');
const productApiSource = fs.readFileSync(path.join(root, 'api/product/[id].js'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const idempotencyMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261002073000_order_idempotency.sql'), 'utf8');
const dishSequenceMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261002074000_dish_id_sequence.sql'), 'utf8');
const atomicSessionMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261002075000_atomic_session_close.sql'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected ${name} in HTML source`);

  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  throw new Error(`Could not parse ${name}`);
}

function makeElement(value = '') {
  const attributes = new Map();
  return {
    value,
    disabled: false,
    hidden: true,
    inert: false,
    isConnected: true,
    focused: false,
    setAttribute(name, valueToSet) {
      attributes.set(name, String(valueToSet));
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    focus() {
      this.focused = true;
    },
  };
}

function makeClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add(...names) {
      names.forEach((name) => classes.add(name));
    },
    remove(...names) {
      names.forEach((name) => classes.delete(name));
    },
    contains(name) {
      return classes.has(name);
    },
  };
}

function makeTrackedClassList(initial = []) {
  const classes = new Set(initial);
  const operations = [];
  return {
    operations,
    add(...names) {
      operations.push(['add', ...names]);
      names.forEach((name) => classes.add(name));
    },
    remove(...names) {
      operations.push(['remove', ...names]);
      names.forEach((name) => classes.delete(name));
    },
    contains(name) {
      return classes.has(name);
    },
  };
}

function stickySearchHarness({ intersectionObserver = true, sentinelTop = 12, stickyTop = 0 } = {}) {
  const bar = { classList: makeClassList(), parentNode: null };
  const listeners = new Map();
  const viewportListeners = new Map();
  const animationFrames = [];
  let currentSentinelTop = sentinelTop;
  let currentStickyTop = stickyTop;
  let observerCallback = null;
  let observerOptions = null;
  let observedElement = null;
  const observers = [];
  const inserted = [];
  const parentNode = {
    insertBefore(element, reference) {
      inserted.push({ element, reference });
      element.parentNode = this;
    },
  };
  bar.parentNode = parentNode;
  const document = {
    documentElement: {},
    querySelector(selector) {
      return selector === '.sticky-bar' ? bar : null;
    },
    createElement(tagName) {
      assert.equal(tagName, 'div');
      return {
        className: '',
        parentNode: null,
        setAttribute() {},
        getBoundingClientRect() {
          return { top: currentSentinelTop };
        },
      };
    },
  };
  const contextValues = {
    document,
    window: {
      addEventListener(type, callback) {
        listeners.set(type, callback);
      },
      getComputedStyle() {
        return { top: `${currentStickyTop}px` };
      },
      visualViewport: {
        addEventListener(type, callback) {
          viewportListeners.set(type, callback);
        },
      },
    },
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
      return animationFrames.length;
    },
  };
  contextValues.getComputedStyle = contextValues.window.getComputedStyle;
  if (intersectionObserver) {
    contextValues.IntersectionObserver = function IntersectionObserver(callback, options) {
      observerCallback = callback;
      observerOptions = options;
      const instance = {
        disconnected: false,
        options,
        observe(element) {
          instance.observedElement = element;
          observedElement = element;
        },
        disconnect() {
          instance.disconnected = true;
        },
      };
      observers.push(instance);
      return instance;
    };
  }
  const context = vm.createContext(contextValues);
  vm.runInContext(`${extractFunction(indexSource, 'initSmartStickySearch')};initSmartStickySearch();`, context);

  return {
    bar,
    inserted,
    listeners,
    viewportListeners,
    observers,
    observerOptions: () => observerOptions,
    observedElement: () => observedElement,
    pendingAnimationFrames: () => animationFrames.length,
    runAnimationFrame() {
      const callbacks = animationFrames.splice(0);
      callbacks.forEach((callback) => callback());
    },
    setSentinelTop(value) {
      currentSentinelTop = value;
    },
    setStickyTop(value) {
      currentStickyTop = value;
    },
    notifyIntersection() {
      observerCallback?.([]);
    },
  };
}

function checkoutHarness({
  phone = '',
  address = '',
  paymentMethod = 'card',
  mode = 'd',
  hasItems = true,
  pickupTime = mode === 'p' ? '13:00' : '',
  availablePickupSlots = ['13:00', '13:20'],
} = {}) {
  const elements = {
    orderBtn: makeElement(),
    phoneInp: makeElement(phone),
    addrInp: makeElement(address),
    paymentMethodInp: makeElement(paymentMethod),
    phoneErr: makeElement(),
    addrErr: makeElement(),
    paymentMethodErr: makeElement(),
    pickupTimeBlock: { style: {} },
    pickupTimeTrigger: makeElement(),
    pickupTimeErr: makeElement(),
    addrBlock: { style: {} },
  };
  elements.pickupTimeTrigger.textContent = pickupTime || 'Выберите время';
  const deliveryButtons = [
    { classList: makeClassList(['on']) },
    { classList: makeClassList() },
  ];
  let prepared = false;
  let builtTextPayload = null;
  const orderPayload = { snapshot: true };

  const context = vm.createContext({
    cart: hasItems ? { 1: 1 } : {},
    delMode: mode,
    pickupTime,
    PAYMENT_METHOD_LABELS: {
      kaspi_invoice: 'Выставить счёт на оплату Kaspi',
      card: 'Оплата картой',
      cash: 'Оплата наличными',
    },
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
      querySelectorAll(selector) {
        return selector === '.dopt' ? deliveryButtons : [];
      },
    },
    showToast() {},
    resetPickupDrag() {},
    getAvailablePickupSlots() {
      return [...availablePickupSlots];
    },
    buildOrderPayload() {
      return orderPayload;
    },
    buildOrderText(payload) {
      builtTextPayload = payload;
      return 'order';
    },
    prepareServiceSheet() {
      prepared = true;
    },
    closeOv() {},
    openOv() {},
    dialogOpeners: new WeakMap(),
    pendingOrderText: '',
    pendingOrderPayload: null,
  });

  for (const name of ['validPhone', 'syncPickupTimeControl', 'updateOrderState', 'setDel', 'placeOrder']) {
    vm.runInContext(`${extractFunction(indexSource, name)};this.${name}=${name};`, context);
  }

  return {
    context,
    deliveryButtons,
    elements,
    orderPayload,
    builtTextPayload: () => builtTextPayload,
    wasPrepared: () => prepared,
  };
}

function orderPayloadHarness({ mode = 'd', paymentMethod = 'kaspi_invoice' } = {}) {
  const elements = {
    nameInp: makeElement('  Алина  '),
    phoneInp: makeElement('  +7 999 123 45 67  '),
    addrInp: makeElement('  Ленина, 1  '),
    entranceInp: makeElement('  2  '),
    floorInp: makeElement('  3  '),
    flatInp: makeElement('  4  '),
    intercomInp: makeElement('  45  '),
    paymentMethodInp: makeElement(paymentMethod),
    commentTa: makeElement('  Без лука  '),
  };
  const item = { id: 7, n: 'Филадельфия', p: 400 };
  const context = vm.createContext({
    cart: { 7: 2 },
    delMode: mode,
    pickupTime: mode === 'p' ? '13:20' : '19:00',
    PAYMENT_METHOD_LABELS: Object.freeze({
      kaspi_invoice: 'Выставить счёт на оплату Kaspi',
      card: 'Оплата картой',
      cash: 'Оплата наличными',
    }),
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
    getItem(id) {
      return Number(id) === item.id ? item : null;
    },
    fmt(value) {
      return `${value} ₸`;
    },
  });
  for (const name of ['currentTotal', 'buildOrderPayload', 'buildOrderText']) {
    vm.runInContext(`${extractFunction(indexSource, name)};this.${name}=${name};`, context);
  }
  return { context, elements, item };
}

function sharingHarness({ clipboardRejects = false } = {}) {
  const elements = {
    shareOv: { classList: makeClassList() },
    shareTitle: makeElement(),
    shareSub: makeElement(),
    shareWaLabel: makeElement(),
    shareCopyBtn: makeElement(),
    pickupTimeTrigger: makeElement(),
    pickupTimeErr: makeElement(),
  };
  elements.pickupTimeTrigger.textContent = '13:20';
  const copied = [];
  const toasts = [];
  const location = { href: 'https://example.test/menu?category=rolls#popular' };
  const context = vm.createContext({
    SHOP_PHONE: '+998711234567',
    SHOP_PHONE_TEXT: '+998 71 123 45 67',
    pendingOrderText: '',
    pendingOrderPayload: null,
    pickupTime: '13:20',
    cart: { 1: 2 },
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
    location,
    window: { location },
    navigator: {
      clipboard: {
        writeText(text) {
          copied.push(text);
          return clipboardRejects
            ? Promise.reject(new Error('clipboard unavailable'))
            : Promise.resolve();
        },
      },
    },
    setSecondService() {},
    runAfterMotion(callback) {
      callback();
    },
    setTimeout(callback) {
      callback();
    },
    closeOv() {},
    updatePill() {},
    syncCardState() {},
    renderCart() {},
    showToast(message) {
      toasts.push(message);
    },
  });

  for (const name of ['syncPickupTimeControl', 'prepareServiceSheet', 'finishOrder', 'copyOrder']) {
    vm.runInContext(`${extractFunction(indexSource, name)};this.${name}=${name};`, context);
  }

  return { context, copied, elements, toasts };
}

function runCookieScript(storedValue) {
  const cookieBar = { classList: makeClassList() };
  const storage = new Map();
  if (storedValue !== undefined) storage.set('cookieOk', storedValue);
  const context = vm.createContext({
    document: {
      getElementById(id) {
        return id === 'cookieBar' ? cookieBar : null;
      },
    },
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
    },
  });
  const marker = '/* ── COOKIE BAR ── */';
  const start = indexSource.indexOf(marker);
  const end = indexSource.indexOf('/* ── CATEGORY SCROLL-SPY', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  vm.runInContext(indexSource.slice(start + marker.length, end), context);

  return { context, cookieBar, storage };
}

function dialogHarness({
  fallbackPrecedesOpener = false,
  openerFocusFails = false,
  firstFrameHidden = false,
  deferAnimationFrames = false,
} = {}) {
  const scheduled = [];
  const animationFrames = [];
  let animationFrame = 0;
  const bodyClassList = makeClassList();
  const opener = makeElement();
  const fallback = makeElement();
  const background = makeElement();
  const cookieBar = makeElement();
  const cartPill = makeElement();
  const phoneInp = makeElement('1234567890');
  const addrInp = makeElement('Main 1');
  const paymentMethodInp = makeElement('card');
  const phoneErr = makeElement();
  const addrErr = makeElement();
  const paymentMethodErr = makeElement();
  const pickupTimeTrigger = makeElement();
  const pickupTimeErr = makeElement();
  const overlays = {};
  const closeButtons = {};
  const shareButtons = {};

  for (const id of ['prodOv', 'shareOv', 'cartOv', 'pickupTimeOv']) {
    const closeButton = makeElement();
    const shareButton = makeElement();
    const overlay = makeElement();
    overlay.id = id;
    overlay.classList = makeClassList();
    overlay.contains = (element) => element === closeButton || element === shareButton;
    overlay.querySelector = (selector) => (
      selector === '[data-dialog-initial-focus]' ? closeButton : null
    );
    overlay.querySelectorAll = () => [shareButton, closeButton];
    overlay.focus = function focus() {
      if(!firstFrameHidden || animationFrame >= 2) document.activeElement = this;
    };
    closeButton.closest = () => overlay;
    shareButton.closest = () => overlay;
    closeButtons[id] = closeButton;
    shareButtons[id] = shareButton;
    overlays[id] = overlay;
  }

  for (const element of [opener, fallback, ...Object.values(closeButtons), ...Object.values(shareButtons)]) {
    element.matches = () => true;
    if (!element.closest) element.closest = () => null;
    element.getClientRects = () => {
      const hiddenByModalLock = element === opener && bodyClassList.contains('modal-lock');
      return hiddenByModalLock ? [] : [{}];
    };
  }
  const document = {
    activeElement: opener,
    body: {
      classList: bodyClassList,
      style: {},
      children: [background, cookieBar, cartPill, overlays.prodOv, overlays.shareOv, overlays.cartOv, overlays.pickupTimeOv],
    },
    documentElement: { scrollTop: 0 },
    getElementById(id) {
      return overlays[id]
        || {
          phoneInp,
          addrInp,
          paymentMethodInp,
          phoneErr,
          addrErr,
          paymentMethodErr,
          pickupTimeTrigger,
          pickupTimeErr,
        }[id]
        || null;
    },
    querySelector(selector) {
      if (selector === '.ov.on') {
        return Object.values(overlays).find((overlay) => overlay.classList.contains('on')) || null;
      }
      if (selector === '#cpill.on,.contact-btn') return fallbackPrecedesOpener ? fallback : opener;
      return null;
    },
    querySelectorAll(selector) {
      if (selector !== '#cpill.on,.contact-btn') return [];
      return fallbackPrecedesOpener ? [fallback, opener] : [opener, fallback];
    },
  };
  opener.focus = function focus() {
    if (!openerFocusFails && this.getClientRects().length) {
      this.focused = true;
      document.activeElement = this;
    }
  };
  fallback.focus = function focus() {
    this.focused = true;
    document.activeElement = this;
  };
  for (const element of [...Object.values(closeButtons), ...Object.values(shareButtons)]) {
    element.focus = function focus() {
      this.focused = true;
      document.activeElement = this;
    };
  }
  const context = vm.createContext({
    cart: { 1: 1 },
    delMode: 'd',
    pickupTime: '',
    PAYMENT_METHOD_LABELS: {
      kaspi_invoice: 'Выставить счёт на оплату Kaspi',
      card: 'Оплата картой',
      cash: 'Оплата наличными',
    },
    pendingOrderText: '',
    pendingOrderPayload: null,
    document,
    window: {
      scrollY: 0,
      scrollTo() {},
      getComputedStyle(element) {
        return {
          display: element.getClientRects().length ? 'block' : 'none',
          visibility: firstFrameHidden && animationFrame < 2 ? 'hidden' : 'visible',
        };
      },
    },
    requestAnimationFrame(callback) {
      if(firstFrameHidden || deferAnimationFrames) animationFrames.push(callback);
      else callback();
    },
    runAfterMotion(callback) {
      scheduled.push(callback);
    },
    setTimeout(callback) {
      scheduled.push(callback);
    },
    buildOrderPayload() {
      return { snapshot: true };
    },
    buildOrderText() {
      return 'order';
    },
    prepareServiceSheet() {},
    showToast() {},
    resetPickupDrag() {},
    getAvailablePickupSlots() {
      return [];
    },
  });
  const declarations = [
    "let lockedScrollY=0",
    "const dialogOpeners=new WeakMap()",
    "const dialogFocusGenerations=new WeakMap()",
    "const dialogSuppressedStates=new WeakMap()",
    "const openDialogs=[]",
    "const dialogFocusableSelector='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex=\"-1\"])'",
  ].join(';');
  const accessibilityFunctions = indexSource.includes('function syncDialogAccessibility(')
    ? ['setDialogSuppressed', 'syncDialogAccessibility'].map((name) => extractFunction(indexSource, name))
    : ['function syncDialogAccessibility(){}'];
  const functions = [
    'isFocusable',
    'focusElement',
    'getDialogFocusable',
    'getTopmostOpenDialog',
    'focusDialog',
    'restoreFocus',
    'lockPageScroll',
    'unlockPageScroll',
    'openOv',
    'closeOv',
    'validPhone',
    'placeOrder',
  ].map((name) => extractFunction(indexSource, name)).concat(accessibilityFunctions).join('\n');
  vm.runInContext(`${declarations};${functions}`, context);

  return {
    context,
    background,
    cartPill,
    closeButtons,
    cookieBar,
    fallback,
    opener,
    overlay: overlays.cartOv,
    overlays,
    shareButtons,
    runNextAnimationFrame() {
      animationFrame += 1;
      animationFrames.shift()?.();
    },
    runAnimationFrame() {
      animationFrame += 1;
      const callbacks = animationFrames.splice(0);
      callbacks.forEach((callback) => callback());
    },
    runScheduled() {
      while (scheduled.length) scheduled.shift()();
    },
  };
}

function productCardHarness({ grid = true } = {}) {
  const dialog = dialogHarness();
  dialog.context.prefersReducedMotion = () => false;
  const elements = {
    menuArea: makeElement(),
    popularCard: makeElement(),
    popDots: makeElement(),
    popularTrack: { style: {} },
    prodContent: makeElement(),
  };
  const originalGetElementById = dialog.context.document.getElementById;
  dialog.context.document.getElementById = (id) => elements[id] || originalGetElementById(id);

  vm.runInContext(`
    const M=[{id:1,c:'f',n:'Тестовый ролл',w:'200 г',d:'Описание',p:500,img:'roll.webp',i:'r'}];
    const CATS=[{id:'f',l:'Роллы'}];
    const CN={f:'Роллы'};
    const POPULAR_IDS=[1];
    let isGrid=${grid},activeCat='all',search='',popIndex=0,popularDidDrag=false;
    ${[
    'getItem',
    'fmt',
    'priceText',
    'shownQty',
    'shownTotal',
    'addBtnHtml',
    'addBtnAria',
    'cartAddButton',
    'priceMarkup',
    'qtyPriceHtml',
    'renderPopular',
    'renderPopularDots',
    'updatePopular',
    'filtered',
    'render',
    'openPopularItem',
    'openProd',
  ].map((name) => extractFunction(indexSource, name)).join('\n')}
  `, dialog.context);

  dialog.context.renderPopular();
  dialog.context.render();

  return { ...dialog, elements };
}

function invokeRenderedDetailsControl(context, html) {
  const match = html.match(/<button[^>]*class="product-details-btn"[^>]*onclick="([^"]+)"/);
  assert.ok(match, 'Expected a rendered product details button');
  const control = makeElement();
  control.matches = () => true;
  control.closest = () => null;
  control.getClientRects = () => [{}];
  control.focus = function focus() {
    this.focused = true;
    context.document.activeElement = this;
  };
  context.renderedControl = control;
  vm.runInContext(`(function(){${match[1]}}).call(renderedControl)`, context);
  return control;
}

function assertNoNestedButtons(html) {
  let buttonDepth = 0;
  for (const match of html.matchAll(/<\/?button\b[^>]*>/g)) {
    if (match[0].startsWith('</')) buttonDepth -= 1;
    else buttonDepth += 1;
    assert.ok(buttonDepth <= 1, `Found nested buttons in rendered HTML: ${match[0]}`);
  }
  assert.equal(buttonDepth, 0);
}

test('index.html and menu.html remain byte-identical', () => {
  assert.deepEqual(
    fs.readFileSync(path.join(root, 'index.html')),
    fs.readFileSync(path.join(root, 'menu.html')),
  );
});

test('order method control clearly transitions its active state', () => {
  for (const source of [indexSource, menuSource]) {
    const stylesStart = source.lastIndexOf('.del-row{background:#efeff4');
    const stylesEnd = source.indexOf('/* Пояснение к комментарию', stylesStart);
    assert.notEqual(stylesStart, -1);
    assert.notEqual(stylesEnd, -1);

    const effectiveStyles = source.slice(stylesStart, stylesEnd);
    assert.match(
      effectiveStyles,
      /\.dopt\{[^}]*transition:background-color 180ms ease-out,color 180ms ease-out[^}]*\}/,
    );
    assert.match(
      effectiveStyles,
      /\.dopt\.on\{[^}]*background:#3f3f3f!important;[^}]*color:#fff!important;[^}]*\}/,
    );
  }
});

test('horizontal overflow protection does not create a sticky-breaking root scroll container', () => {
  for (const source of [indexSource, menuSource]) {
    assert.doesNotMatch(source, /html,body\{[^}]*overflow-x:hidden/);
    assert.match(source, /html,body\{[^}]*overflow-x:clip/);
  }
});

test('restaurant header uses the exact requested schedule and delivery text', () => {
  assert.match(indexSource, /<span id="shopSchedule"><\/span>/);
  assert.match(extractFunction(indexSource, 'renderShopSchedule'), /`График: с \$\{SHOP_SCHEDULE\.open\} до \$\{SHOP_SCHEDULE\.close\}`/);
  assert.match(indexSource, />Доставка: от 4 900₸ бесплатная в радиусе 10 км\.</);
  assert.doesNotMatch(indexSource, /График:С|Доставка:От/);
});

test('fixed and sticky mobile surfaces account for every safe-area inset', () => {
  assert.match(indexSource, /viewport-fit=cover/);
  for (const inset of ['top', 'right', 'bottom', 'left']) {
    assert.match(indexSource, new RegExp(`env\\(safe-area-inset-${inset}, 0px\\)`));
  }
  assert.match(indexSource, /\.cart-pill-shell[\s\S]*safe-area-inset-bottom/);
  assert.match(indexSource, /\.cookie-bar[\s\S]*safe-area-inset-bottom/);
  assert.match(indexSource, /\.ov[\s\S]*safe-area-inset-top/);
  assert.match(indexSource, /\.sticky-bar\.is-stuck[\s\S]*safe-area-inset-top/);
  assert.match(indexSource, /#prodOv \.ps-top[\s\S]*safe-area-inset-right/);
  assert.match(indexSource, /#cartOv \.cs-head[\s\S]*safe-area-inset-left/);
});

test('search bar uses native sticky positioning without fixed-state artifacts or placeholders', () => {
  assert.match(
    indexSource,
    /\.sticky-bar\{[^}]*position:sticky!important;[^}]*top:env\(safe-area-inset-top,0px\)!important;/,
  );
  assert.doesNotMatch(indexSource, /\.sticky-bar\.is-stuck\{[^}]*position:fixed/);
  assert.doesNotMatch(indexSource, /\.sticky-bar\.is-stuck\{[^}]*(?:left:50%|translateX\(-50%\))/);
  assert.doesNotMatch(indexSource, /sticky-placeholder/);

  const implementation = extractFunction(indexSource, 'initSmartStickySearch');
  assert.match(implementation, /IntersectionObserver/);
  assert.doesNotMatch(implementation, /pageYOffset|offsetHeight/);
  assert.doesNotMatch(implementation, /\.style\./);
});

test('sticky search sentinel toggles only visual state across down and up transitions', () => {
  const harness = stickySearchHarness({ sentinelTop: -1, stickyTop: 10 });

  assert.equal(harness.inserted.length, 1);
  assert.equal(harness.inserted[0].element.className, 'sticky-sentinel');
  assert.equal(harness.inserted[0].reference, harness.bar);
  assert.equal(harness.observedElement(), harness.inserted[0].element);
  assert.equal(harness.observerOptions().rootMargin, '-10px 0px 0px 0px');
  assert.equal(harness.bar.classList.contains('is-stuck'), true);

  harness.setSentinelTop(20);
  harness.notifyIntersection();
  assert.equal(harness.bar.classList.contains('is-stuck'), false);

  harness.setSentinelTop(5);
  harness.notifyIntersection();
  assert.equal(harness.bar.classList.contains('is-stuck'), true);

  harness.setSentinelTop(25);
  harness.notifyIntersection();
  assert.equal(harness.bar.classList.contains('is-stuck'), false);

  harness.setSentinelTop(-3);
  harness.notifyIntersection();
  assert.equal(harness.bar.classList.contains('is-stuck'), true);
});

test('sticky observer recreates and resyncs only when the effective top changes', () => {
  const harness = stickySearchHarness({ sentinelTop: 15, stickyTop: 10 });

  assert.equal(harness.observers.length, 1);
  assert.equal(harness.observers[0].options.rootMargin, '-10px 0px 0px 0px');
  assert.equal(harness.bar.classList.contains('is-stuck'), false);

  harness.setSentinelTop(15);
  harness.listeners.get('resize')();
  assert.equal(harness.observers.length, 1);
  assert.equal(harness.bar.classList.contains('is-stuck'), false);

  harness.setStickyTop(20);
  harness.listeners.get('orientationchange')();
  assert.equal(harness.observers.length, 2);
  assert.equal(harness.observers[0].disconnected, true);
  assert.equal(harness.observers[1].options.rootMargin, '-20px 0px 0px 0px');
  assert.equal(harness.bar.classList.contains('is-stuck'), true);

  harness.setStickyTop(6);
  harness.viewportListeners.get('resize')();
  assert.equal(harness.observers.length, 3);
  assert.equal(harness.observers[1].disconnected, true);
  assert.equal(harness.observers[2].options.rootMargin, '-6px 0px 0px 0px');
  assert.equal(harness.bar.classList.contains('is-stuck'), false);
});

test('sticky observer resyncs geometry without recreation when top is unchanged', () => {
  const harness = stickySearchHarness({ sentinelTop: 15, stickyTop: 10 });

  harness.setSentinelTop(5);
  harness.listeners.get('resize')();

  assert.equal(harness.observers.length, 1);
  assert.equal(harness.observers[0].disconnected, false);
  assert.equal(harness.bar.classList.contains('is-stuck'), true);
});

test('sticky observer clears stale visual state when scrolling ends below the sentinel', () => {
  const harness = stickySearchHarness({ sentinelTop: -20, stickyTop: 10 });

  assert.equal(harness.bar.classList.contains('is-stuck'), true);

  harness.setSentinelTop(765);
  assert.equal(harness.bar.classList.contains('is-stuck'), true);

  harness.listeners.get('scrollend')();

  assert.equal(harness.bar.classList.contains('is-stuck'), false);
  assert.equal(harness.observers.length, 1);
  assert.equal(harness.observers[0].disconnected, false);
});

test('sticky search fallback keeps native positioning and updates visual state from sentinel geometry', () => {
  const harness = stickySearchHarness({
    intersectionObserver: false,
    sentinelTop: 20,
    stickyTop: 8,
  });

  assert.equal(harness.bar.classList.contains('is-stuck'), false);
  assert.deepEqual([...harness.listeners.keys()], ['scroll', 'resize', 'orientationchange']);
  assert.deepEqual([...harness.viewportListeners.keys()], ['resize']);

  harness.setSentinelTop(4);
  harness.listeners.get('scroll')();
  assert.equal(harness.bar.classList.contains('is-stuck'), false);
  harness.runAnimationFrame();
  assert.equal(harness.bar.classList.contains('is-stuck'), true);

  harness.setSentinelTop(12);
  harness.listeners.get('scroll')();
  harness.runAnimationFrame();
  assert.equal(harness.bar.classList.contains('is-stuck'), false);
});

test('sticky fallback throttles repeated geometry updates through one animation frame', () => {
  const harness = stickySearchHarness({
    intersectionObserver: false,
    sentinelTop: 20,
    stickyTop: 8,
  });

  harness.setSentinelTop(4);
  harness.listeners.get('scroll')();
  harness.listeners.get('scroll')();
  harness.listeners.get('scroll')();

  assert.equal(harness.pendingAnimationFrames(), 1);
  assert.equal(harness.bar.classList.contains('is-stuck'), false);

  harness.runAnimationFrame();
  assert.equal(harness.pendingAnimationFrames(), 0);
  assert.equal(harness.bar.classList.contains('is-stuck'), true);
});

test('sticky visual state CSS preserves flow geometry at every breakpoint', () => {
  const stuckRules = [...indexSource.matchAll(/\.sticky-bar\.is-stuck\s*\{([^}]*)\}/g)];
  assert.ok(stuckRules.length > 0);
  for (const [, declarations] of stuckRules) {
    assert.doesNotMatch(
      declarations,
      /(?:^|;)\s*(?:width|max-width|padding(?:-(?:top|right|bottom|left))?|margin(?:-(?:top|right|bottom|left))?)\s*:/,
    );
  }
});

test('mobile interactive controls expose at least 44px CSS hit areas', () => {
  const requiredSelectors = [
    '.add-sq', '.gc-plus', '.ps-add', '.qb', '.cs-trash', '.cs-close',
    '.ps-icon-btn', '.ss-x', '.ss-copy', '.ss-opt', '.s-action',
    '.cookie-ok', '.grid-toggle', '.cat', '.dot-item', '.cart-pill',
  ];
  for (const selector of requiredSelectors) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      indexSource,
      new RegExp(`${escaped}[^{}]*\\{[^}]*min-(?:width|inline-size):44px[^}]*min-(?:height|block-size):44px`),
      `Expected a 44x44 hit-area rule for ${selector}`,
    );
  }
  assert.match(indexSource, /\.dot-item::before\{[^}]*width:5px[^}]*height:5px/);
});

test('mobile form inputs and textareas retain at least 44px actual hit heights', () => {
  assert.match(
    indexSource,
    /\.contact-btn,\.dopt,\.order-btn,\.addr-inp,\.s-inp,\.cmnt-ta\{min-height:44px!important\}/,
  );
  assert.match(indexSource, /#cartOv \.addr-inp\{min-height:44px!important/);
  assert.match(indexSource, /#cartOv \.cmnt-ta\{[^}]*min-height:(?:[4-9]\d|\d{3,})px!important/);

  const formControls = [...indexSource.matchAll(/<(?:input|textarea)\b[^>]*class="([^"]+)"/g)];
  assert.ok(formControls.length > 0);
  for (const [, classes] of formControls) {
    assert.match(classes, /(?:^|\s)(?:addr-inp|s-inp|cmnt-ta)(?:\s|$)/);
  }
});

test('reduced motion disables CSS motion and bypasses timed JavaScript effects', () => {
  assert.match(indexSource, /@media\(prefers-reduced-motion:reduce\)\{[\s\S]*scroll-behavior:auto!important/);
  assert.match(indexSource, /@media\(prefers-reduced-motion:reduce\)\{[\s\S]*animation:none!important[\s\S]*transition:none!important/);
  assert.match(indexSource, /matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(extractFunction(indexSource, 'prefersReducedMotion'), /reducedMotionQuery\?\.matches/);
  assert.match(extractFunction(indexSource, 'slowScrollTo'), /if\(prefersReducedMotion\(\)\)\{window\.scrollTo\(0,endY\);return;\}/);
  assert.match(extractFunction(indexSource, 'animateCardsIn'), /if\(prefersReducedMotion\(\)\)return;/);
  assert.match(indexSource, /window\.toggleView=function\(\)\{[\s\S]*if\(prefersReducedMotion\(\)\)/);
  assert.match(extractFunction(indexSource, 'updatePopular'), /prefersReducedMotion\(\)/);
});

test('reduced motion centralizes immediate modal and share closure delays', () => {
  const runAfterMotion = extractFunction(indexSource, 'runAfterMotion');
  const closeOv = extractFunction(indexSource, 'closeOv');
  const shareVia = extractFunction(indexSource, 'shareVia');
  const copyOrder = extractFunction(indexSource, 'copyOrder');

  assert.match(runAfterMotion, /if\(prefersReducedMotion\(\)\)\{callback\(\);return;\}/);
  assert.match(closeOv, /runAfterMotion\(\(\)=>\{[\s\S]*\},20\)/);
  assert.match(shareVia, /runAfterMotion\(\(\)=>closeOv\('shareOv'\),400\)/);
  assert.match(copyOrder, /runAfterMotion\(\(\)=>closeOv\('shareOv'\),400\)/);

  const scheduled = [];
  let calls = 0;
  const context = vm.createContext({
    prefersReducedMotion: () => true,
    setTimeout(callback, delay) {
      scheduled.push({ callback, delay });
    },
  });
  vm.runInContext(`${runAfterMotion};this.runAfterMotion=runAfterMotion;`, context);
  context.callback = () => {
    calls += 1;
  };
  vm.runInContext('runAfterMotion(callback, 400)', context);
  assert.equal(calls, 1);
  assert.equal(scheduled.length, 0);

  context.prefersReducedMotion = () => false;
  vm.runInContext('runAfterMotion(callback, 400)', context);
  assert.equal(calls, 1);
  assert.equal(scheduled[0].delay, 400);
  scheduled[0].callback();
  assert.equal(calls, 2);
});

test('reduced-motion toast stays readable without forced animation choreography and auto-clears', () => {
  const classList = makeTrackedClassList(['on']);
  let reflows = 0;
  const toast = { classList, textContent: '' };
  Object.defineProperty(toast, 'offsetWidth', {
    get() {
      reflows += 1;
      return 100;
    },
  });
  const scheduled = [];
  const context = vm.createContext({
    document: {
      getElementById(id) {
        return id === 'toastEl' ? toast : null;
      },
    },
    prefersReducedMotion: () => true,
    setTimeout(callback, delay) {
      scheduled.push({ callback, delay });
    },
  });
  for (const name of ['restartMotionClass', 'showToast']) {
    vm.runInContext(`${extractFunction(indexSource, name)};this.${name}=${name};`, context);
  }

  context.showToast('Готово');

  assert.equal(toast.textContent, 'Готово');
  assert.equal(toast.classList.contains('on'), true);
  assert.equal(reflows, 0);
  assert.deepEqual(classList.operations, [['add', 'on']]);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 2600);

  scheduled[0].callback();
  assert.equal(toast.classList.contains('on'), false);
});

test('normal-motion toast preserves forced restart choreography and timing', () => {
  const classList = makeTrackedClassList(['on']);
  let reflows = 0;
  const toast = { classList, textContent: '' };
  Object.defineProperty(toast, 'offsetWidth', {
    get() {
      reflows += 1;
      return 100;
    },
  });
  const scheduled = [];
  const context = vm.createContext({
    document: {
      getElementById() {
        return toast;
      },
    },
    prefersReducedMotion: () => false,
    setTimeout(callback, delay) {
      scheduled.push({ callback, delay });
    },
  });
  for (const name of ['restartMotionClass', 'showToast']) {
    vm.runInContext(`${extractFunction(indexSource, name)};this.${name}=${name};`, context);
  }

  context.showToast('Готово');

  assert.equal(reflows, 1);
  assert.deepEqual(classList.operations, [['remove', 'on'], ['add', 'on']]);
  assert.equal(scheduled[0].delay, 2600);
});

test('all overlays expose named modal dialog semantics', () => {
  assert.match(indexSource, /id="prodOv"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="prodTitle"/);
  assert.match(indexSource, /id="shareOv"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="shareTitle"/);
  assert.match(indexSource, /id="cartOv"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="cartTitle"/);
  assert.match(indexSource, /class="ps-name" id="prodTitle">\$\{item\.n\}<\/div>/);
  assert.match(indexSource, /class="cs-title" id="cartTitle">Корзина<\/div>/);
});

test('icon-only product and cart controls have accessible names', () => {
  assert.match(indexSource, /class="ps-icon-btn"[^>]*aria-label="Поделиться"/);
  assert.match(indexSource, /class="ps-icon-btn"[^>]*aria-label="Закрыть товар"/);
  assert.match(indexSource, /class="cs-trash"[^>]*aria-label="Очистить корзину"/);
  assert.match(indexSource, /class="cs-close"[^>]*aria-label="Закрыть корзину"/);
});

test('rendered popular card opens product details from a named native button and restores focus to it', () => {
  const card = productCardHarness();
  const html = card.elements.popularCard.innerHTML;

  assert.match(html, /<div class="pop-card">/);
  assert.match(html, /<button type="button" class="product-details-btn"[^>]*aria-label="Подробнее о Тестовый ролл"/);
  assert.match(html, /<button type="button" class="add-sq pop-add-top cart-add-btn/);
  assertNoNestedButtons(html);

  const control = invokeRenderedDetailsControl(card.context, html);
  card.context.closeOv('prodOv');
  card.runScheduled();

  assert.equal(control.focused, true);
  assert.equal(card.context.document.activeElement, control);
});

test('rendered grid card opens product details from a named native button and restores focus to it', () => {
  const card = productCardHarness();
  const html = card.elements.menuArea.innerHTML;

  assert.match(html, /<div class="gc">/);
  assert.match(html, /<button type="button" class="product-details-btn"[^>]*aria-label="Подробнее о Тестовый ролл"/);
  assert.match(html, /<button type="button" class="gc-plus cart-add-btn/);
  assertNoNestedButtons(html);

  const control = invokeRenderedDetailsControl(card.context, html);
  card.context.closeOv('prodOv');
  card.runScheduled();

  assert.equal(control.focused, true);
  assert.equal(card.context.document.activeElement, control);
});

test('rendered list card opens product details from a named native button and restores focus to it', () => {
  const card = productCardHarness({ grid: false });
  const html = card.elements.menuArea.innerHTML;

  assert.match(html, /<div class="lc">/);
  assert.match(html, /<button type="button" class="product-details-btn"[^>]*aria-label="Подробнее о Тестовый ролл"/);
  assert.match(html, /<button type="button" class="add-sq cart-add-btn/);
  assertNoNestedButtons(html);

  const control = invokeRenderedDetailsControl(card.context, html);
  card.context.closeOv('prodOv');
  card.runScheduled();

  assert.equal(control.focused, true);
  assert.equal(card.context.document.activeElement, control);
});

test('dialog lifecycle stores and restores focus while preserving order transition focus', () => {
  const openOv = extractFunction(indexSource, 'openOv');
  const closeOv = extractFunction(indexSource, 'closeOv');
  const restoreFocus = extractFunction(indexSource, 'restoreFocus');
  const placeOrder = extractFunction(indexSource, 'placeOrder');

  assert.match(openOv, /document\.activeElement/);
  assert.match(openOv, /dialogOpeners\.set\(ov,/);
  assert.match(openOv, /focusDialog\(ov\)/);
  assert.match(closeOv, /restoreFocus/);
  assert.match(closeOv, /dialogOpeners\.get\(ov\)/);
  assert.match(restoreFocus, /getTopmostOpenDialog\(\)/);
  assert.match(placeOrder, /const transitionOpener=dialogOpeners\.get\(document\.getElementById\('cartOv'\)\);/);
  assert.match(placeOrder, /closeOv\('cartOv',false\);\s*openOv\('shareOv',transitionOpener\);/);
});

test('initial focus retries after first-frame transition visibility and enters each top dialog', () => {
  for (const id of ['prodOv', 'shareOv', 'cartOv']) {
    const dialog = dialogHarness({ firstFrameHidden: true });

    dialog.context.openOv(id);
    dialog.runAnimationFrame();
    assert.equal(dialog.context.document.activeElement, dialog.opener);

    dialog.runAnimationFrame();
    assert.equal(dialog.context.document.activeElement, dialog.closeButtons[id]);
  }
});

test('delayed initial focus does not enter a dialog that closed during its transition', () => {
  const dialog = dialogHarness({ firstFrameHidden: true });

  dialog.context.openOv('prodOv');
  dialog.runAnimationFrame();
  dialog.context.closeOv('prodOv', false);
  dialog.runAnimationFrame();

  assert.notEqual(dialog.context.document.activeElement, dialog.closeButtons.prodOv);
});

test('stale initial focus does not enter the same dialog after it is closed and reopened', () => {
  const dialog = dialogHarness({ deferAnimationFrames: true });

  dialog.context.openOv('prodOv');
  dialog.context.closeOv('prodOv', false);
  dialog.context.openOv('prodOv');
  dialog.runNextAnimationFrame();

  assert.equal(dialog.context.document.activeElement, dialog.opener);
  assert.equal(dialog.closeButtons.prodOv.focused, false);
});

test('closing cart restores focus after modal lock stops hiding its opener', () => {
  const dialog = dialogHarness();

  dialog.context.openOv('cartOv');
  dialog.context.closeOv('cartOv');

  assert.equal(dialog.opener.focused, false);
  assert.equal(dialog.context.document.body.classList.contains('modal-lock'), true);

  dialog.runScheduled();

  assert.equal(dialog.context.document.body.classList.contains('modal-lock'), false);
  assert.equal(dialog.opener.focused, true);
});

test('failed opener focus falls back to the next visible safe control', () => {
  const dialog = dialogHarness({ openerFocusFails: true });

  dialog.context.openOv('cartOv');
  dialog.context.closeOv('cartOv');
  dialog.runScheduled();

  assert.equal(dialog.opener.focused, false);
  assert.equal(dialog.fallback.focused, true);
});

test('cart-to-share transition restores focus to the original visible cart opener', () => {
  const dialog = dialogHarness({ fallbackPrecedesOpener: true });

  dialog.context.openOv('cartOv');
  dialog.context.placeOrder();
  dialog.context.closeOv('shareOv');
  dialog.runScheduled();

  assert.equal(dialog.fallback.focused, false);
  assert.equal(dialog.opener.focused, true);
  assert.equal(dialog.context.document.activeElement, dialog.opener);
});

test('only the topmost nested dialog remains exposed and interactive', () => {
  const dialog = dialogHarness();

  dialog.context.openOv('prodOv');

  assert.equal(dialog.overlays.prodOv.inert, false);
  assert.equal(dialog.overlays.prodOv.getAttribute('aria-hidden'), null);
  assert.equal(dialog.background.inert, true);
  assert.equal(dialog.background.getAttribute('aria-hidden'), 'true');

  dialog.context.document.activeElement = dialog.shareButtons.prodOv;
  dialog.context.openOv('shareOv');

  assert.equal(dialog.overlays.shareOv.inert, false);
  assert.equal(dialog.overlays.shareOv.getAttribute('aria-hidden'), null);
  assert.equal(dialog.overlays.prodOv.inert, true);
  assert.equal(dialog.overlays.prodOv.getAttribute('aria-hidden'), 'true');
  assert.equal(dialog.background.inert, true);
  assert.equal(dialog.background.getAttribute('aria-hidden'), 'true');
});

test('closing the top nested dialog restores the lower dialog before the page', () => {
  const dialog = dialogHarness();

  dialog.context.openOv('prodOv');
  dialog.context.document.activeElement = dialog.shareButtons.prodOv;
  dialog.context.openOv('shareOv');
  dialog.context.closeOv('shareOv');

  assert.equal(dialog.overlays.prodOv.inert, false);
  assert.equal(dialog.overlays.prodOv.getAttribute('aria-hidden'), null);
  assert.equal(dialog.background.inert, true);
  assert.equal(dialog.background.getAttribute('aria-hidden'), 'true');

  dialog.context.closeOv('prodOv');
  dialog.runScheduled();

  assert.equal(dialog.background.inert, false);
  assert.equal(dialog.background.getAttribute('aria-hidden'), null);
  assert.equal(dialog.cookieBar.inert, false);
  assert.equal(dialog.cartPill.getAttribute('aria-hidden'), null);
});

test('one global keyboard handler traps Tab and closes only the topmost dialog', () => {
  const handler = extractFunction(indexSource, 'handleDialogKeydown');
  const registrations = indexSource.match(/document\.addEventListener\('keydown',handleDialogKeydown\)/g) || [];

  assert.equal(registrations.length, 1);
  assert.match(handler, /getTopmostOpenDialog\(\)/);
  assert.match(handler, /e\.key==='Escape'/);
  assert.match(handler, /closeOv\(topmost\.id\)/);
  assert.match(handler, /e\.key!=='Tab'/);
  assert.match(handler, /e\.shiftKey/);
  assert.match(handler, /focusable\[focusable\.length-1\]/);
  assert.match(handler, /focusable\[0\]/);
});

test('background-click closure remains wired for every dialog', () => {
  for (const id of ['prodOv', 'shareOv', 'cartOv']) {
    assert.match(indexSource, new RegExp(`id="${id}"[^>]*onclick="bgClose\\(event,'${id}'\\)"`));
  }
});

test('cookie consent is visible until cookieOk is persisted', () => {
  assert.doesNotMatch(indexSource, /\.cookie-bar\{display:none!important\}/);

  const firstVisit = runCookieScript();
  assert.equal(firstVisit.cookieBar.classList.contains('on'), true);

  firstVisit.context.acceptCookies();
  assert.equal(firstVisit.storage.get('cookieOk'), '1');
  assert.equal(firstVisit.cookieBar.classList.contains('on'), false);

  const acceptedReload = runCookieScript('1');
  assert.equal(acceptedReload.cookieBar.classList.contains('on'), false);
});

test('contact and product copy actions copy the current page link without clearing the cart', async () => {
  for (const mode of ['contact', 'product']) {
    const sharing = sharingHarness();
    sharing.context.pendingOrderPayload = { existing: true };
    sharing.context.prepareServiceSheet(mode);
    sharing.context.copyOrder();
    await new Promise(setImmediate);

    assert.deepEqual(sharing.copied, ['https://example.test/menu?category=rolls#popular']);
    assert.deepEqual(sharing.context.cart, { 1: 2 });
    assert.equal(sharing.context.pendingOrderText.includes('+998 71 123 45 67'), true);
    assert.deepEqual(sharing.context.pendingOrderPayload, { existing: true });
    assert.equal(sharing.toasts.includes('Ссылка скопирована'), true);
    assert.equal(sharing.toasts.includes('Текст заказа скопирован'), false);
  }
});

test('order copy action copies pending order text and preserves its cart-clearing behavior', async () => {
  const sharing = sharingHarness();
  sharing.context.pendingOrderText = 'Новый заказ № 42';
  sharing.context.pendingOrderPayload = { order: 42 };
  sharing.context.prepareServiceSheet('order');
  sharing.context.copyOrder();
  await new Promise(setImmediate);

  assert.deepEqual(sharing.copied, ['Новый заказ № 42']);
  assert.equal(Object.keys(sharing.context.cart).length, 0);
  assert.equal(sharing.context.pendingOrderText, '');
  assert.equal(sharing.context.pendingOrderPayload, null);
  assert.equal(sharing.toasts.includes('Текст заказа скопирован'), true);
  assert.equal(sharing.toasts.includes('Ссылка скопирована'), false);
});

test('failed copy reports failure without a success toast', async () => {
  const sharing = sharingHarness({ clipboardRejects: true });
  sharing.context.prepareServiceSheet('contact');
  sharing.context.copyOrder();
  await new Promise(setImmediate);

  assert.deepEqual(sharing.toasts, ['Не удалось скопировать — попробуйте другой способ отправки']);
  assert.deepEqual(sharing.context.cart, { 1: 2 });
});

test('failed order copy keeps the cart and pending order for another sending method', async () => {
  const sharing = sharingHarness({ clipboardRejects: true });
  sharing.context.pendingOrderText = 'Новый заказ № 42';
  sharing.context.pendingOrderPayload = { order: 42 };
  sharing.context.prepareServiceSheet('order');
  sharing.context.copyOrder();
  await new Promise(setImmediate);

  assert.deepEqual(sharing.context.cart, { 1: 2 });
  assert.equal(sharing.context.pendingOrderText, 'Новый заказ № 42');
  assert.deepEqual(sharing.context.pendingOrderPayload, { order: 42 });
});

test('phone and address fields have static error descriptions and hidden errors', () => {
  assert.match(indexSource, /id="phoneInp"[^>]*aria-describedby="phoneErr"/);
  assert.match(indexSource, /id="addrInp"[^>]*aria-describedby="addrErr"/);
  assert.match(indexSource, /id="phoneErr"[^>]*hidden/);
  assert.match(indexSource, /id="addrErr"[^>]*hidden/);
  assert.match(indexSource, /const SHOP_PHONE='\+998711234567';/);
});

test('active pages expose one required native payment method select with exact options', () => {
  const expectedOptions = [
    ['', 'Способ оплаты'],
    ['kaspi_invoice', 'Выставить счёт на оплату Kaspi'],
    ['card', 'Оплата картой'],
    ['cash', 'Оплата наличными'],
  ];

  for (const source of [indexSource, menuSource]) {
    assert.doesNotMatch(source, /id="(?:personsInp|paymentInp)"/);
    assert.match(
      source,
      /<label class="cmnt-title" for="paymentMethodInp">Способ оплаты<\/label>\s*<select\b[^>]*id="paymentMethodInp"/,
    );
    const selects = [...source.matchAll(/<select\b[^>]*id="paymentMethodInp"[^>]*>([\s\S]*?)<\/select>/g)];
    assert.equal(selects.length, 1);
    assert.match(selects[0][0], /<select\b[^>]*\brequired\b/);
    assert.match(selects[0][0], /aria-describedby="paymentMethodErr"/);
    assert.match(
      selects[0][1],
      /^\s*<option value="" disabled selected>Способ оплаты<\/option>/,
    );
    const options = [...selects[0][1].matchAll(/<option value="([^"]*)"[^>]*>([^<]+)<\/option>/g)]
      .map((match) => [match[1], match[2]]);
    assert.deepEqual(options, expectedOptions);
    assert.match(source, /id="paymentMethodErr"[^>]*hidden/);
    assert.match(source, /const PAYMENT_METHOD_LABELS=Object\.freeze\(\{/);
    assert.match(
      source,
      /<label class="cmnt-title" for="paymentMethodInp">Способ оплаты<\/label>[\s\S]*?id="paymentMethodErr"[^>]*hidden[^>]*>[\s\S]*?<div class="cmnt-title">Уточнения<\/div>\s*<textarea\b[^>]*id="commentTa"/,
    );
  }
});

test('validPhone accepts only normalized phone numbers containing 10 to 15 digits', () => {
  const { context } = checkoutHarness();

  assert.equal(context.validPhone(''), false);
  assert.equal(context.validPhone('+7 (999) 123-45-6'), true);
  assert.equal(context.validPhone('123456789'), false);
  assert.equal(context.validPhone('123456789012345'), true);
  assert.equal(context.validPhone('1234567890123456'), false);
});

test('updateOrderState requires a valid phone for delivery and pickup', () => {
  for (const mode of ['d', 'p']) {
    const empty = checkoutHarness({ phone: '', address: 'Main 1', mode });
    empty.context.updateOrderState();
    assert.equal(empty.elements.orderBtn.disabled, true);

    const invalid = checkoutHarness({ phone: '123', address: 'Main 1', mode });
    invalid.context.updateOrderState();
    assert.equal(invalid.elements.orderBtn.disabled, true);

    const valid = checkoutHarness({ phone: '+7 (999) 123-45-67', address: 'Main 1', mode });
    valid.context.updateOrderState();
    assert.equal(valid.elements.orderBtn.disabled, false);
  }
});

test('updateOrderState requires an address only for delivery', () => {
  const delivery = checkoutHarness({ phone: '1234567890', address: '', mode: 'd' });
  delivery.context.updateOrderState();
  assert.equal(delivery.elements.orderBtn.disabled, true);

  const pickup = checkoutHarness({ phone: '1234567890', address: '', mode: 'p' });
  pickup.context.updateOrderState();
  assert.equal(pickup.elements.orderBtn.disabled, false);
});

test('updateOrderState requires a payment method for delivery and pickup', () => {
  for (const mode of ['d', 'p']) {
    const checkout = checkoutHarness({
      phone: '1234567890',
      address: 'Main 1',
      paymentMethod: '',
      mode,
    });
    checkout.context.updateOrderState();
    assert.equal(checkout.elements.orderBtn.disabled, true);
  }
});

test('validation errors remain hidden until an invalid submit is attempted', () => {
  const checkout = checkoutHarness({ phone: '', address: '', mode: 'd' });
  checkout.context.updateOrderState();

  assert.equal(checkout.elements.phoneErr.hidden, true);
  assert.equal(checkout.elements.addrErr.hidden, true);
  assert.equal(checkout.elements.phoneInp.getAttribute('aria-invalid'), null);
  assert.equal(checkout.elements.addrInp.getAttribute('aria-invalid'), null);
});

test('placeOrder blocks direct invalid submission and focuses the first invalid field', () => {
  const checkout = checkoutHarness({ phone: '', address: '', mode: 'd' });
  checkout.context.placeOrder();

  assert.equal(checkout.wasPrepared(), false);
  assert.equal(checkout.elements.phoneErr.hidden, false);
  assert.equal(checkout.elements.addrErr.hidden, false);
  assert.equal(checkout.elements.phoneInp.getAttribute('aria-invalid'), 'true');
  assert.equal(checkout.elements.addrInp.getAttribute('aria-invalid'), 'true');
  assert.equal(checkout.elements.phoneInp.focused, true);
  assert.equal(checkout.elements.addrInp.focused, false);
});

test('placeOrder focuses address when it is the first invalid field', () => {
  const checkout = checkoutHarness({ phone: '1234567890', address: '', mode: 'd' });
  checkout.context.placeOrder();

  assert.equal(checkout.wasPrepared(), false);
  assert.equal(checkout.elements.phoneErr.hidden, true);
  assert.equal(checkout.elements.addrErr.hidden, false);
  assert.equal(checkout.elements.addrInp.getAttribute('aria-invalid'), 'true');
  assert.equal(checkout.elements.phoneInp.focused, false);
  assert.equal(checkout.elements.addrInp.focused, true);
});

test('placeOrder blocks pickup with an invalid phone and focuses phone', () => {
  const checkout = checkoutHarness({ phone: '123', mode: 'p' });
  checkout.context.placeOrder();

  assert.equal(checkout.wasPrepared(), false);
  assert.equal(checkout.elements.phoneErr.hidden, false);
  assert.equal(checkout.elements.phoneInp.getAttribute('aria-invalid'), 'true');
  assert.equal(checkout.elements.phoneInp.focused, true);
  assert.equal(checkout.elements.addrErr.hidden, true);
});

test('placeOrder rejects an otherwise valid checkout without payment in both modes', () => {
  for (const mode of ['d', 'p']) {
    const checkout = checkoutHarness({
      phone: '1234567890',
      address: 'Main 1',
      paymentMethod: '',
      mode,
    });
    checkout.context.placeOrder();

    assert.equal(checkout.wasPrepared(), false);
    assert.equal(checkout.elements.paymentMethodErr.hidden, false);
    assert.equal(checkout.elements.paymentMethodInp.getAttribute('aria-invalid'), 'true');
    assert.equal(checkout.elements.paymentMethodInp.focused, true);
  }
});

test('placeOrder proceeds with valid checkout contacts', () => {
  const checkout = checkoutHarness({
    phone: '+7 (999) 123-45-67',
    address: 'Main 1',
    mode: 'd',
  });
  checkout.context.placeOrder();

  assert.equal(checkout.wasPrepared(), true);
  assert.equal(checkout.elements.phoneErr.hidden, true);
  assert.equal(checkout.elements.addrErr.hidden, true);
  assert.equal(checkout.context.pendingOrderPayload, checkout.orderPayload);
  assert.equal(checkout.builtTextPayload(), checkout.orderPayload);
});

test('correcting invalid inputs clears stale errors and aria-invalid', () => {
  const checkout = checkoutHarness({ phone: '', address: '', mode: 'd' });
  checkout.context.placeOrder();

  checkout.elements.phoneInp.value = '+7 999 123 45 67';
  checkout.elements.addrInp.value = 'Main 1';
  checkout.context.updateOrderState();

  assert.equal(checkout.elements.phoneErr.hidden, true);
  assert.equal(checkout.elements.addrErr.hidden, true);
  assert.equal(checkout.elements.phoneInp.getAttribute('aria-invalid'), null);
  assert.equal(checkout.elements.addrInp.getAttribute('aria-invalid'), null);
  assert.equal(checkout.elements.orderBtn.disabled, false);
});

test('choosing payment clears its stale error and enables submit', () => {
  const checkout = checkoutHarness({
    phone: '1234567890',
    address: 'Main 1',
    paymentMethod: '',
  });
  checkout.context.placeOrder();
  assert.equal(checkout.elements.paymentMethodErr.hidden, false);

  checkout.elements.paymentMethodInp.value = 'cash';
  checkout.context.updateOrderState();

  assert.equal(checkout.elements.paymentMethodErr.hidden, true);
  assert.equal(checkout.elements.paymentMethodInp.getAttribute('aria-invalid'), null);
  assert.equal(checkout.elements.orderBtn.disabled, false);
});

test('setDel preserves the selected payment method', () => {
  const checkout = checkoutHarness({ paymentMethod: 'kaspi_invoice' });
  const pickupButton = checkout.deliveryButtons[1];

  checkout.context.setDel('p', pickupButton);

  assert.equal(checkout.elements.paymentMethodInp.value, 'kaspi_invoice');
});

test('buildOrderPayload returns the exact copied delivery snapshot contract', () => {
  const harness = orderPayloadHarness();
  const payload = harness.context.buildOrderPayload();

  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    items: [{
      id: 7,
      name: 'Филадельфия',
      quantity: 2,
      unitPrice: 400,
      lineTotal: 800,
    }],
    total: 800,
    orderMethod: 'delivery',
    contact: { name: 'Алина', phone: '+7 999 123 45 67' },
    deliveryAddress: {
      address: 'Ленина, 1',
      entrance: '2',
      floor: '3',
      flat: '4',
      intercom: '45',
    },
    pickupTime: null,
    paymentMethod: 'kaspi_invoice',
    comment: 'Без лука',
  });

  harness.context.cart[7] = 9;
  harness.item.n = 'Изменено';
  harness.item.p = 999;
  harness.elements.nameInp.value = 'Другой клиент';
  harness.elements.addrInp.value = 'Другой адрес';
  assert.equal(payload.items[0].name, 'Филадельфия');
  assert.equal(payload.items[0].quantity, 2);
  assert.equal(payload.items[0].unitPrice, 400);
  assert.equal(payload.contact.name, 'Алина');
  assert.equal(payload.deliveryAddress.address, 'Ленина, 1');
});

test('buildOrderPayload uses pickup and omits delivery address', () => {
  const harness = orderPayloadHarness({ mode: 'p', paymentMethod: 'cash' });
  const payload = harness.context.buildOrderPayload();

  assert.equal(payload.orderMethod, 'pickup');
  assert.equal(payload.deliveryAddress, null);
  assert.equal(payload.paymentMethod, 'cash');
});

test('buildOrderText renders the readable payment label without a persons line', () => {
  const harness = orderPayloadHarness({ paymentMethod: 'card' });
  const payload = harness.context.buildOrderPayload();
  const text = harness.context.buildOrderText(payload);

  assert.match(text, /Оплата: Оплата картой/);
  assert.doesNotMatch(text, /Персон:/);
  assert.match(text, /Новый заказ Sushi Crazy\n\n1\. Филадельфия/);
  assert.doesNotMatch(text, /\\n/);
});

test('pickup schedule has one machine-readable source and the header renders from it', () => {
  assert.match(
    indexSource,
    /const SHOP_SCHEDULE=Object\.freeze\(\{open:'11:00',close:'22:40',utcOffsetMinutes:300\}\);/,
  );
  assert.match(indexSource, /const PICKUP_PREPARATION_MINUTES=40;/);
  assert.match(indexSource, /const PICKUP_SLOT_STEP_MINUTES=20;/);
  assert.equal((indexSource.match(/11:00/g) || []).length, 1);
  assert.equal((indexSource.match(/22:40/g) || []).length, 1);
  assert.match(indexSource, /id="shopSchedule"/);
  assert.match(
    extractFunction(indexSource, 'renderShopSchedule'),
    /SHOP_SCHEDULE\.open[\s\S]*SHOP_SCHEDULE\.close/,
  );
});

test('pickup time helpers use injected dates and UTC-only restaurant arithmetic', () => {
  const declarations = [
    "const SHOP_SCHEDULE=Object.freeze({open:'11:00',close:'22:40',utcOffsetMinutes:300})",
    'const PICKUP_PREPARATION_MINUTES=40',
    'const PICKUP_SLOT_STEP_MINUTES=20',
  ].join(';');
  const helperNames = [
    'parseTimeMinutes',
    'formatTimeMinutes',
    'getRestaurantLocalMinutes',
    'getAvailablePickupSlots',
  ];
  const context = vm.createContext({});
  vm.runInContext(
    `${declarations};${helperNames.map((name) => extractFunction(indexSource, name)).join('\n')};`
      + `this.helpers={${helperNames.join(',')}};`,
    context,
  );
  const helpers = context.helpers;

  assert.equal(helpers.parseTimeMinutes('11:00'), 660);
  assert.equal(helpers.formatTimeMinutes(1360), '22:40');
  assert.equal(helpers.getRestaurantLocalMinutes(new Date('2026-07-16T05:00:00Z')), 600);
  const cases = [
    ['2026-07-16T05:00:00Z', ['11:00', '11:20']],
    ['2026-07-16T07:07:00Z', ['13:00', '13:20']],
    ['2026-07-16T07:20:00Z', ['13:00', '13:20']],
    ['2026-07-16T07:20:01Z', ['13:20', '13:40']],
    ['2026-07-16T17:00:00Z', ['22:40']],
    ['2026-07-16T17:01:00Z', []],
    ['2026-07-16T20:30:00Z', ['11:00', '11:20']],
  ];
  for (const [instant, expectedStart] of cases) {
    const slots = [...helpers.getAvailablePickupSlots(new Date(instant))];
    assert.deepEqual(slots.slice(0, expectedStart.length), expectedStart);
    if (!expectedStart.length) assert.deepEqual(slots, []);
  }
});

test('pickup controls and body-level dialog expose accessible semantics', () => {
  const commentEnd = indexSource.indexOf('</textarea>', indexSource.indexOf('id="commentTa"'));
  const pickupBlock = indexSource.indexOf('id="pickupTimeBlock"', commentEnd);
  assert.ok(pickupBlock > commentEnd);
  assert.equal(indexSource.slice(commentEnd + 11, pickupBlock).trim().startsWith('<div'), true);
  assert.match(
    indexSource,
    /id="pickupTimeBlock"[^>]*hidden[\s\S]*?<label[^>]*for="pickupTimeTrigger"[^>]*>Время самовывоза<\/label>[\s\S]*?<button[^>]*id="pickupTimeTrigger"[^>]*aria-haspopup="dialog"[^>]*aria-controls="pickupTimeOv"[^>]*aria-expanded="false"[^>]*aria-describedby="pickupTimeErr"[^>]*>Выберите время<\/button>[\s\S]*?id="pickupTimeErr"[^>]*hidden/,
  );

  const cartStart = indexSource.indexOf('<div class="ov" id="cartOv"');
  const cartEnd = indexSource.indexOf('<div class="toast"', cartStart);
  const pickupDialog = indexSource.indexOf('<div class="ov pickup-time-ov" id="pickupTimeOv"');
  assert.ok(pickupDialog > cartEnd, 'pickup dialog must be a body-level sibling after cart');
  assert.match(
    indexSource,
    /id="pickupTimeOv"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="pickupTimeTitle"[^>]*aria-describedby="pickupTimeDescription"[^>]*onclick="bgClose\(event,'pickupTimeOv'\)"/,
  );
  assert.match(indexSource, /id="pickupTimeTitle"[^>]*>Время самовывоза</);
  assert.match(indexSource, /id="pickupTimeDescription"/);
  assert.match(indexSource, /id="pickupTimeClose"[^>]*data-dialog-initial-focus/);
  assert.match(indexSource, /id="pickupTimeSlots"/);
  assert.match(indexSource, /id="pickupTimeUnavailable"[^>]*role="status"/);
});

test('cart overlay closes before the body-level toast and pickup dialog', () => {
  const closingBoundary = /<button class="order-btn" id="orderBtn"[^>]*>Оформить заказ<\/button>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<div class="toast" id="toastEl"><\/div>\s*<!-- PICKUP TIME OVERLAY -->\s*<div class="ov pickup-time-ov" id="pickupTimeOv"/;

  for (const source of [indexSource, menuSource]) {
    assert.match(source, closingBoundary);
  }
});

test('pickup picker has nested stacking, responsive modes, safe-area, and reduced-motion styling', () => {
  const sheetMedia = '(max-width:600px), (max-height:600px) and (pointer:coarse)';
  for (const source of [indexSource, menuSource]) {
    const rule = source.match(/#pickupTimeOv\{[^}]*z-index:(\d+)!important[^}]*\}/);
    assert.ok(rule, 'Expected an explicit #pickupTimeOv z-index');
    assert.ok(Number(rule[1]) > 130, 'Expected #pickupTimeOv to stack above #cartOv');
    const dragZoneRule = source.match(/\.pickup-time-drag-zone\{([^}]*)\}/);
    assert.ok(dragZoneRule, 'Expected pickup drag-zone styling');
    assert.match(dragZoneRule[1], /(?:^|;)-webkit-user-select:none(?:;|$)/);
    assert.match(dragZoneRule[1], /(?:^|;)user-select:none(?:;|$)/);
  }
  assert.match(indexSource, /#pickupTimeOv\{[^}]*background:transparent/);
  assert.match(indexSource, /#pickupTimeOv \.pickup-time-panel\{[^}]*position:fixed[^}]*transform:scale\(/);
  for (const source of [indexSource, menuSource]) {
    const mediaStart = source.indexOf(`@media${sheetMedia}{`);
    assert.notEqual(mediaStart, -1);
    const mediaStyles = source.slice(mediaStart, source.indexOf('@media(prefers-reduced-motion:reduce)', mediaStart));
    assert.match(mediaStyles, /#pickupTimeOv\{[^}]*align-items:flex-end/);
    assert.match(
      mediaStyles,
      /#pickupTimeOv\{[^}]*padding:0 env\(safe-area-inset-right, 0px\) 0 env\(safe-area-inset-left, 0px\)!important/,
    );
    assert.match(mediaStyles, /#pickupTimeOv \.pickup-time-panel\{[^}]*padding-bottom:calc\([^}]*safe-area-inset-bottom/);
    assert.match(mediaStyles, /\.pickup-time-slot\{[^}]*min-height:44px/);
  }
  assert.match(indexSource, /@media\(prefers-reduced-motion:reduce\)\{[\s\S]*#pickupTimeOv \.pickup-time-panel/);
});

test('pickup sheet breakpoint covers portrait and coarse-pointer landscape but not short mouse desktops', () => {
  const declarations = indexSource.match(
    /const PICKUP_TIME_SHEET_MEDIA='[^']+';\s*const pickupTimeSheetQuery=window\.matchMedia\?\.\(PICKUP_TIME_SHEET_MEDIA\);/,
  );
  assert.ok(declarations);
  const predicate = extractFunction(indexSource, 'isPickupTimeSheetMode');
  const cases = [
    [{ width: 390, height: 844, pointer: 'coarse' }, true],
    [{ width: 844, height: 390, pointer: 'coarse' }, true],
    [{ width: 844, height: 390, pointer: 'fine' }, false],
    [{ width: 1024, height: 768, pointer: 'coarse' }, false],
  ];

  for (const [viewport, expected] of cases) {
    let requestedMedia = '';
    const context = vm.createContext({
      window: {
        matchMedia(media) {
          requestedMedia = media;
          return {
            matches: viewport.width <= 600
              || (viewport.height <= 600 && viewport.pointer === 'coarse'),
          };
        },
      },
    });
    vm.runInContext(
      `${declarations[0]}${predicate};this.isPickupTimeSheetMode=isPickupTimeSheetMode;`,
      context,
    );

    assert.equal(
      requestedMedia,
      '(max-width:600px), (max-height:600px) and (pointer:coarse)',
    );
    assert.equal(context.isPickupTimeSheetMode(), expected);
  }
});

test('pickup picker generation, stale clearing, selection, and drag lifecycle are wired', () => {
  const openPicker = extractFunction(indexSource, 'openPickupTimePicker');
  const positionPanel = extractFunction(indexSource, 'positionPickupTimePanel');
  const selectTime = extractFunction(indexSource, 'selectPickupTime');
  const dragStart = extractFunction(indexSource, 'startPickupDrag');
  const dragMove = extractFunction(indexSource, 'movePickupDrag');
  const dragEnd = extractFunction(indexSource, 'endPickupDrag');
  const dragCancel = extractFunction(indexSource, 'cancelPickupDrag');

  assert.match(openPicker, /getAvailablePickupSlots\(new Date\(\)\)/);
  assert.match(openPicker, /pickupTime=''[\s\S]*syncPickupTimeControl/);
  assert.match(openPicker, /const sheetMode=isPickupTimeSheetMode\(\)/);
  assert.match(openPicker, /positionPickupTimePanel\(trigger,sheetMode\)/);
  assert.match(openPicker, /renderPickupTimeSlots/);
  assert.match(openPicker, /openOv\('pickupTimeOv'/);
  assert.match(positionPanel, /if\(!panel\|\|sheetMode\)return/);
  assert.match(selectTime, /getAvailablePickupSlots\(new Date\(\)\)/);
  assert.match(selectTime, /pickupTime=time/);
  assert.match(selectTime, /closeOv\('pickupTimeOv'\)/);
  assert.match(indexSource, /aria-pressed="\$\{time===pickupTime\}"/);

  assert.match(indexSource, /id="pickupTimeDragZone"[^>]*onpointerdown="startPickupDrag\(event\)"/);
  assert.doesNotMatch(indexSource, /id="pickupTimeSlots"[^>]*onpointerdown/);
  assert.match(dragStart, /if\(!isPickupTimeSheetMode\(\)\|\|event\.button!==0\)return/);
  assert.match(dragStart, /setPointerCapture/);
  assert.match(dragStart, /addEventListener\('pointermove',movePickupDrag\)/);
  assert.match(dragMove, /translateY/);
  assert.match(dragEnd, /releasePointerCapture/);
  assert.match(dragEnd, /pickupDragOffset>[\d]+[\s\S]*closeOv\('pickupTimeOv'\)/);
  assert.match(dragCancel, /resetPickupDrag/);
  assert.match(extractFunction(indexSource, 'cleanupPickupDrag'), /removeEventListener\('pointermove',movePickupDrag\)/);
});

test('pickup is freshly required only for pickup checkout and stale state is not mutated by availability checks', () => {
  const stale = checkoutHarness({
    phone: '1234567890',
    mode: 'p',
    pickupTime: '13:00',
    availablePickupSlots: ['13:20'],
  });
  stale.context.updateOrderState();
  assert.equal(stale.elements.orderBtn.disabled, true);
  assert.equal(stale.context.pickupTime, '13:00');

  const delivery = checkoutHarness({
    phone: '1234567890',
    address: 'Main 1',
    mode: 'd',
    pickupTime: '',
    availablePickupSlots: [],
  });
  delivery.context.updateOrderState();
  assert.equal(delivery.elements.orderBtn.disabled, false);
});

test('placeOrder clears and focuses stale pickup selection after valid phone', () => {
  const checkout = checkoutHarness({
    phone: '1234567890',
    mode: 'p',
    pickupTime: '13:00',
    availablePickupSlots: ['13:20'],
  });
  checkout.context.placeOrder();

  assert.equal(checkout.wasPrepared(), false);
  assert.equal(checkout.context.pickupTime, '');
  assert.equal(checkout.elements.pickupTimeTrigger.textContent, 'Выберите время');
  assert.equal(checkout.elements.pickupTimeErr.hidden, false);
  assert.equal(checkout.elements.pickupTimeTrigger.getAttribute('aria-invalid'), 'true');
  assert.equal(checkout.elements.pickupTimeTrigger.focused, true);
});

test('placeOrder focuses missing pickup time before payment after a valid phone', () => {
  const checkout = checkoutHarness({
    phone: '1234567890',
    paymentMethod: '',
    mode: 'p',
    pickupTime: '',
  });
  checkout.context.placeOrder();

  assert.equal(checkout.elements.pickupTimeTrigger.focused, true);
  assert.equal(checkout.elements.paymentMethodInp.focused, false);
});

test('pickup payload and text include time while delivery payload explicitly stores null', () => {
  const pickupHarness = orderPayloadHarness({ mode: 'p', paymentMethod: 'cash' });
  const pickupPayload = pickupHarness.context.buildOrderPayload();
  assert.equal(pickupPayload.pickupTime, '13:20');
  assert.match(pickupHarness.context.buildOrderText(pickupPayload), /Время самовывоза: 13:20/);

  const deliveryHarness = orderPayloadHarness();
  const deliveryPayload = deliveryHarness.context.buildOrderPayload();
  assert.equal(deliveryPayload.pickupTime, null);
  assert.doesNotMatch(deliveryHarness.context.buildOrderText(deliveryPayload), /Время самовывоза:/);
});

test('finishOrder resets pickup state, trigger, and error with pending order state', () => {
  const sharing = sharingHarness();
  sharing.context.pendingOrderText = 'Новый заказ № 42';
  sharing.context.pendingOrderPayload = { pickupTime: '13:20' };
  sharing.elements.pickupTimeErr.hidden = false;
  sharing.elements.pickupTimeTrigger.setAttribute('aria-invalid', 'true');

  sharing.context.finishOrder();

  assert.equal(sharing.context.pickupTime, '');
  assert.equal(sharing.elements.pickupTimeTrigger.textContent, 'Выберите время');
  assert.equal(sharing.elements.pickupTimeTrigger.getAttribute('aria-invalid'), null);
  assert.equal(sharing.elements.pickupTimeErr.hidden, true);
  assert.equal(sharing.context.pendingOrderText, '');
  assert.equal(sharing.context.pendingOrderPayload, null);
});

test('pickup dialog participates in nested focus, suppression, and restoration lifecycle', () => {
  const dialog = dialogHarness();
  dialog.context.openOv('cartOv');
  dialog.context.document.activeElement = dialog.shareButtons.cartOv;
  dialog.context.openOv('pickupTimeOv');

  assert.equal(dialog.overlays.pickupTimeOv.inert, false);
  assert.equal(dialog.overlays.cartOv.inert, true);
  assert.equal(dialog.context.document.activeElement, dialog.closeButtons.pickupTimeOv);

  dialog.context.closeOv('pickupTimeOv');
  assert.equal(dialog.overlays.cartOv.inert, false);
  assert.equal(dialog.context.document.activeElement, dialog.shareButtons.cartOv);
});


test('admin order history workspace exposes search, status and payment filters', () => {
  assert.match(adminSource, /data-section="orders"/);
  assert.match(adminSource, /id="pageOrders"[^>]*data-page="orders"/);
  assert.match(adminSource, /id="orderSearch"/);
  assert.match(adminSource, /id="orderFilters"/);
  assert.match(adminSource, /data-filter="active"/);
  assert.match(adminSource, /data-filter="served"/);
  assert.match(adminSource, /data-filter="cancelled"/);
  assert.match(adminSource, /id="orderPayment"/);
  assert.match(adminSource, /id="ordersList"/);
  assert.match(adminSource, /function renderOrders\(\)/);
  assert.match(adminSource, /function loadOrders\(silent=true,force=false\)/);
  assert.match(adminSource, /function fetchAdminOrders\(\)/);
  assert.match(adminSource, /function staffOrdersFallback\(\)/);
  assert.match(adminSource, /source:'open-sessions'/);
});

test('admin order history API is role protected and returns a bounded enriched history', () => {
  assert.match(adminApiSource, /authenticateAdmin\(pin, requestedRole\)/);
  assert.match(adminApiSource, /x-admin-role/);
  assert.match(adminApiSource, /pin === "1"/);
  assert.match(adminApiSource, /if \(action === "orders"\)/);
  assert.match(adminApiSource, /order=created_at\.desc&limit=200/);
  assert.match(adminApiSource, /order_items\?select=id,order_id,dish_id,name,quantity,unit_price,line_total,item_comment/);
  assert.match(adminApiSource, /table: table \? \{ id: table\.id, table_number: table\.table_number, label: table\.label \} : null/);
  assert.doesNotMatch(adminApiSource, /orders\?select=[^"\n]*guest_token/);
});

test('admin order history keeps cancelled orders visible but excludes them from amount and average', () => {
  assert.match(adminApiSource, /const nonCancelled = enriched\.filter\(\(order: any\) => !isCancelled\(order\)\);/);
  assert.match(adminApiSource, /cancelled: enriched\.filter\(\(order: any\) => isCancelled\(order\)\)\.length/);
  assert.match(adminApiSource, /amount: sumTotal\(nonCancelled\)/);
  assert.match(adminApiSource, /averageCheck: averageCheck\(nonCancelled\)/);
  assert.match(adminSource, /Отменённые сохраняются для контроля/);
});

test('admin order history has responsive workspace styles', () => {
  assert.match(opsCssSource, /TASK 10: ADMIN ORDER HISTORY/);
  assert.match(opsCssSource, /\.orders-toolbar\{/);
  assert.match(opsCssSource, /\.admin-order-card\{/);
  assert.match(opsCssSource, /\.order-item-row\{/);
  assert.match(opsCssSource, /@media\(max-width:520px\)/);
});


test('admin reports workspace exposes 30-day metrics and CSV export', () => {
  assert.match(adminSource, /data-section="reports"/);
  assert.match(adminSource, /id="pageReports"[^>]*data-page="reports"/);
  assert.match(adminSource, /id="reportOrders30"/);
  assert.match(adminSource, /id="reportRevenue30"/);
  assert.match(adminSource, /id="reportDaily30"/);
  assert.match(adminSource, /id="reportPayments30"/);
  assert.match(adminSource, /id="reportTables30"/);
  assert.match(adminSource, /function renderReports\(a\)/);
  assert.match(adminSource, /function exportReportsCsv\(\)/);
  assert.match(adminSource, /sushi-crazy-report-30-days\.csv/);
});

test('admin dashboard API returns full 30-day reporting analytics', () => {
  assert.match(adminApiSource, /orders30: orders\.length/);
  assert.match(adminApiSource, /revenue30: sumTotal\(orders\)/);
  assert.match(adminApiSource, /averageCheck30: averageCheck\(orders\)/);
  assert.match(adminApiSource, /cancelled30,/);
  assert.match(adminApiSource, /cancellationRate30,/);
  assert.match(adminApiSource, /averagePrepMinutes,/);
  assert.match(adminApiSource, /medianPrepMinutes,/);
  assert.match(adminApiSource, /hourly30,/);
  assert.match(adminApiSource, /popularDishes30,/);
  assert.match(adminApiSource, /items30,/);
  assert.match(adminApiSource, /daily30: dailyFor\(30\)/);
  assert.match(adminApiSource, /payments30: paymentsFor\(orders\)/);
  assert.match(opsCssSource, /\.reports-grid\{/);
  assert.match(opsCssSource, /\.report-day-meter/);
  assert.match(opsCssSource, /\.report-hourly\{/);
  assert.match(opsCssSource, /\.report-dish-row\{/);
});



test('task 11 stores staff roles behind RLS and never exposes PIN hashes to browser UI', () => {
  assert.match(roleAccessMigration, /create table if not exists public\.staff_members/);
  assert.match(roleAccessMigration, /role in \('owner','admin','waiter','kitchen'\)/);
  assert.match(roleAccessMigration, /alter table public\.staff_members enable row level security/);
  assert.match(roleAccessMigration, /pin_hash text not null/);
  assert.doesNotMatch(adminSource, /pin_hash/);
});

test('task 11 enforces kitchen and waiter permissions on the server', () => {
  assert.match(staffOrdersSource, /type StaffRole = "owner" \| "admin" \| "waiter" \| "kitchen"/);
  assert.match(staffOrdersSource, /"resolve-request": \["owner", "admin", "waiter"\]/);
  assert.match(staffOrdersSource, /"close-session": \["owner", "admin", "waiter"\]/);
  assert.match(staffOrdersSource, /role === "kitchen"/);
  assert.match(staffOrdersSource, /next === "preparing"/);
  assert.match(staffOrdersSource, /next === "ready"/);
  assert.match(staffOrdersSource, /role === "waiter"\) return current === "ready" && next === "served"/);
  assert.match(staffOrdersSource, /Недостаточно прав/);
});

test('task 11 workspaces identify their role explicitly without requiring new CORS headers', () => {
  assert.match(kitchenSource, /JSON\.stringify\(\{action,role:'kitchen',\.\.\.payload\}\)/);
  assert.match(kitchenSource, /sushi-kitchen-pin/);
  assert.doesNotMatch(kitchenSource, /x-staff-role/);
  assert.doesNotMatch(kitchenSource, /sessionStorage\.getItem\('sushi-staff-pin'\)/);
  assert.match(staffSource, /JSON\.stringify\(\{action,role:'waiter',\.\.\.payload\}\)/);
  assert.match(staffSource, /sushi-waiter-pin/);
  assert.doesNotMatch(staffSource, /x-staff-role/);
  assert.doesNotMatch(staffSource, /sessionStorage\.getItem\('sushi-staff-pin'\)/);
  assert.match(adminSource, /JSON\.stringify\(\{action,role:adminRole,\.\.\.payload\}\)/);
  assert.doesNotMatch(adminSource, /'x-admin-role':adminRole/);
});

test('task 11 owner can manage access while admin cannot', () => {
  assert.match(adminSource, /id="accessNavBtn"/);
  assert.match(adminSource, /id="pageAccess"[^>]*data-page="access"/);
  assert.match(adminSource, /id="staffForm"/);
  assert.match(adminSource, /function loadAccess\(silent=true,force=false\)/);
  assert.match(adminApiSource, /actor\.role !== "owner"/);
  assert.match(adminApiSource, /Только владелец может управлять доступом/);
  assert.match(adminApiSource, /Нельзя отключить последнего активного владельца/);
});

test('task 12 captures status history for real preparation-time analytics', () => {
  assert.match(statusEventsMigration, /create table if not exists public\.order_status_events/);
  assert.match(statusEventsMigration, /create trigger orders_capture_status_change/);
  assert.match(statusEventsMigration, /after update of status on public\.orders/);
  assert.match(statusEventsMigration, /old\.status is distinct from new\.status/);
});

test('task 12 reports expose cancellations, preparation time, hourly load and popular dishes', () => {
  for (const id of ['reportCancelled30','reportPrep30','reportHourly30','reportDishes30','reportItems30']) {
    assert.match(adminSource, new RegExp('id="'+id+'"'));
  }
  assert.match(adminSource, /a\.cancellationRate30/);
  assert.match(adminSource, /a\.averagePrepMinutes/);
  assert.match(adminSource, /a\.hourly30/);
  assert.match(adminSource, /a\.popularDishes30/);
  assert.match(adminSource, /Среднее приготовление/);
  assert.match(adminSource, /Загрузка ресторана/);
  assert.match(adminSource, /Популярные блюда/);
});


test('task 13 makes guest order retries idempotent at browser, API and database layers', () => {
  assert.match(indexSource, /ORDER_REQUEST_TTL_MS/);
  assert.match(indexSource, /function getOrderRequestId\(payload\)/);
  assert.match(indexSource, /clientRequestId/);
  assert.match(indexSource, /clearOrderRequestId\(clientRequestId\)/);
  assert.match(tableApiSource, /client_request_id=eq/);
  assert.match(tableApiSource, /duplicate: true/);
  assert.match(idempotencyMigration, /orders_guest_request_unique/);
  assert.match(idempotencyMigration, /guest_token, client_request_id/);
});

test('task 13 does not let background polling reopen a closed table session', () => {
  assert.match(tableApiSource, /if \(action === "bootstrap"\) \{/);
  assert.match(tableApiSource, /Table session is closed/);
  assert.match(tableApiSource, /id=eq\.\$\{encodeURIComponent\(sessionId\)\}/);
  assert.match(indexSource, /sessionId:tableOrdering\.session\?\.id\|\|''/);
  assert.match(indexSource, /\[400,404,409\]\.includes\(Number\(error\?\.status\)\)/);
  assert.match(indexSource, /stopTablePolling\(\)/);
});

test('task 13 isolates saved carts by QR table', () => {
  assert.match(indexSource, /const CART_STORAGE_KEY='sushi-crazy-cart-v2'/);
  assert.match(indexSource, /function cartStorageKey\(\)/);
  assert.match(indexSource, /tableOrdering\?\.tableToken\|\|'browse'/);
  assert.match(indexSource, /LEGACY_CART_STORAGE_KEY/);
  assert.match(indexSource, /localStorage\.setItem\(cartStorageKey\(\),JSON\.stringify\(cart\)\)/);
});

test('task 13 rejects duplicate item rows that bypass the per-dish quantity cap', () => {
  assert.match(tableApiSource, /const quantities = new Map<number, number>\(\)/);
  assert.match(tableApiSource, /const totalQuantity = \(quantities\.get\(id\) \|\| 0\) \+ quantity/);
  assert.match(tableApiSource, /if \(totalQuantity > 20\)/);
});

test('task 13 deduplicates simultaneous open service requests', () => {
  assert.match(idempotencyMigration, /service_requests_one_open_per_guest_kind/);
  assert.match(idempotencyMigration, /where status = 'open'/);
  assert.match(tableApiSource, /The unique partial index turns simultaneous taps\/tabs into one open request/);
});

test('task 13 prevents menu data from injecting HTML into guest cards', () => {
  assert.match(indexSource, /pop-name">\$\{tableEscapeHtml\(item\.n\)\}/);
  assert.match(indexSource, /gc-name">\$\{tableEscapeHtml\(item\.n\)\}/);
  assert.match(indexSource, /lc-desc">\$\{tableEscapeHtml\(item\.d\)\}/);
  assert.match(indexSource, /ps-desc">\$\{tableEscapeHtml\(item\.d\)\}/);
  assert.match(indexSource, /ci-name">\$\{tableEscapeHtml\(item\.n\)\}/);
});

test('task 13 bounds menu and PWA network waits and prevents overlapping table status polls', () => {
  assert.match(indexSource, /MENU_API_TIMEOUT_MS=12000/);
  assert.match(indexSource, /tableOrdering\.loading\|\|tableOrdering\.statusLoading/);
  assert.match(indexSource, /finally\{tableOrdering\.statusLoading=false;\}/);
  assert.match(indexSource, /signal:controller\.signal/);
  assert.match(swSource, /NETWORK_TIMEOUT_MS=8000/);
  assert.match(swSource, /fetch\(request,\{signal:controller\.signal\}\)/);
});

test('task 13 keeps stopped dishes stopped in product share routes', () => {
  assert.doesNotMatch(productApiSource, /ref-products-dom\.json/);
  assert.match(productApiSource, /is_available=eq\.true/);
  assert.match(productApiSource, /status:'unavailable'/);
  assert.match(productApiSource, /statusCode=503/);
  assert.match(productApiSource, /Cache-Control','no-store/);
});

test('task 13 keeps kitchen cancellation usable while waiter actions remain separate', () => {
  assert.match(staffOrdersSource, /if \(next === "cancelled"\) return \["submitted", "accepted", "preparing"\]\.includes\(current\)/);
  assert.match(staffOrdersSource, /role === "waiter"\) return current === "ready" && next === "served"/);
  assert.match(kitchenSource, /openCancel\(/);
});

test('task 13 masks operational PIN inputs', () => {
  assert.match(kitchenSource, /id="pin" type="password" inputmode="numeric" maxlength="12"/);
  assert.match(staffSource, /id="pin" type="password" inputmode="numeric" maxlength="12"/);
});

test('task 13 calculates reports in the restaurant timezone instead of UTC', () => {
  assert.match(adminApiSource, /RESTAURANT_TIME_ZONE = "Europe\/Moscow"/);
  assert.match(adminApiSource, /restaurantDateKey\(order\.created_at\)/);
  assert.match(adminApiSource, /restaurantHour\(order\.created_at\)/);
  assert.doesNotMatch(adminSource, /UTC\+5/);
});

test('task 13 lets PostgreSQL allocate dish ids atomically', () => {
  assert.match(dishSequenceMigration, /create sequence if not exists public\.dishes_id_seq/);
  assert.match(dishSequenceMigration, /alter column id set default nextval/);
  assert.doesNotMatch(adminApiSource, /function nextDishId/);
  assert.match(adminApiSource, /Prefer: "return=representation"/);
  assert.match(adminApiSource, /createdDishId/);
});


test('task 13 serializes table closing against concurrent order creation', () => {
  assert.match(atomicSessionMigration, /create trigger orders_require_open_session/);
  assert.match(atomicSessionMigration, /before insert on public\.orders/);
  assert.match(atomicSessionMigration, /for share/);
  assert.match(atomicSessionMigration, /create or replace function public\.close_table_session_if_idle/);
  assert.match(atomicSessionMigration, /for update/);
  assert.match(atomicSessionMigration, /status in \('submitted','accepted','preparing','ready'\)/);
  assert.match(staffOrdersSource, /rpc\/close_table_session_if_idle/);
  assert.match(tableApiSource, /Table session is closed/);
});

test('task 13 makes competing order status updates compare-and-set', () => {
  assert.match(staffOrdersSource, /orders\?id=eq\.\$\{orderId\}&status=eq\.\$\{encodeURIComponent\(String\(order\.status\)\)\}/);
  assert.match(staffOrdersSource, /Prefer: "return=representation"/);
  assert.match(staffOrdersSource, /Заказ уже изменён на другом экране/);
  assert.match(staffOrdersSource, /409/);
});

test('task 13 scopes staff polling to open sessions instead of full order history', () => {
  assert.match(staffOrdersSource, /status=eq\.open&order=opened_at\.asc/);
  assert.match(staffOrdersSource, /table_session_id=in\.\(\$\{sessionIds\.join\(","\)\}\)/);
  assert.match(staffOrdersSource, /order_id=in\.\(\$\{orderIds\.join\(","\)\}\)/);
  assert.doesNotMatch(staffOrdersSource, /db\("orders\?select=[^"]*&order=created_at\.asc"\)/);
  assert.doesNotMatch(staffOrdersSource, /db\("order_items\?select=[^"]*&order=id\.asc"\)/);
});

test('task 13 operational workspaces tolerate unavailable Web Storage', () => {
  assert.match(adminSource, /const sessionGet=.*try\{return sessionStorage\.getItem/);
  assert.match(adminSource, /const sessionSet=.*try\{sessionStorage\.setItem/);
  assert.match(kitchenSource, /const sessionGet=.*try\{return sessionStorage\.getItem/);
  assert.match(kitchenSource, /const localGet=.*try\{return localStorage\.getItem/);
  assert.match(staffSource, /const sessionGet=.*try\{return sessionStorage\.getItem/);
  assert.match(staffSource, /const localSet=.*try\{localStorage\.setItem/);
});

test('task 13 30-day analytics uses local calendar dates and counts old open sessions', () => {
  assert.match(adminApiSource, /const dates30 = calendarKeys\(30\)/);
  assert.match(adminApiSource, /orderWindow\.filter\(\(order: any\) => dates30\.has\(restaurantDateKey\(order\.created_at\)\)\)/);
  assert.match(adminApiSource, /table_sessions\?select=id,table_id,status,opened_at,closed_at,updated_at&status=eq\.open/);
  assert.match(adminApiSource, /const openSessions = Array\.isArray\(openSessionsRaw\)/);
});
