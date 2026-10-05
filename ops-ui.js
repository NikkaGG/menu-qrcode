(() => {
  const modals = [...document.querySelectorAll('.modal, .admin-order-drawer')];
  const openers = new WeakMap();
  let currentDialog = null;
  const iconNames = { gear: 'settings', chart: 'chart-no-axes-combined', 'place-setting': 'utensils', 'frying-pan': 'chef-hat', bellhop: 'concierge-bell', bell: 'bell', receipt: 'receipt-text' };
  const icon = name => { const node = document.createElement('i'); node.dataset.lucide = name; node.setAttribute('aria-hidden', 'true'); return node; };
  function renderIcons() {
    document.querySelectorAll('.admin-attention-item>img, .attention-icon').forEach(img => {
      const name = img.getAttribute('src').split('/').pop().split('.')[0];
      img.replaceWith(icon(iconNames[name] || 'bell'));
    });
    if (document.querySelector('i[data-lucide]') && window.lucide) {
      lucide.createIcons({ attrs: { 'aria-hidden': 'true', 'stroke-width': 1.8 } });
      document.querySelectorAll('svg[data-lucide]').forEach(node => node.removeAttribute('data-lucide'));
    }
  }
  const navIcons = { overview: 'layout-dashboard', orders: 'receipt-text', tables: 'armchair', menu: 'utensils', reports: 'chart-no-axes-combined' };
  document.querySelectorAll('#adminNav [data-section]').forEach(btn => {
    btn.querySelector('svg')?.replaceWith(icon(navIcons[btn.dataset.section]));
    btn.setAttribute('aria-current', btn.classList.contains('on') ? 'page' : 'false');
  });
  document.querySelectorAll('.admin-refresh').forEach(btn => { btn.replaceChildren(icon('refresh-cw')); btn.title = 'Обновить данные'; });
  document.querySelectorAll('.table-search>span').forEach(el => el.replaceChildren(icon('search')));
  document.querySelectorAll('.x').forEach(btn => { btn.replaceChildren(icon('x')); btn.setAttribute('aria-label', 'Закрыть'); btn.title = 'Закрыть'; });
  document.querySelectorAll('.admin-logout svg').forEach(svg => svg.replaceWith(icon('log-out')));
  document.querySelectorAll('.admin-workspaces summary svg').forEach(svg => svg.replaceWith(icon('panels-top-left')));
  document.querySelectorAll('.admin-mobile-more summary svg').forEach(svg => svg.replaceWith(icon('ellipsis')));
  document.querySelectorAll('.create-table-btn').forEach(btn => btn.prepend(icon('plus')));
  document.getElementById('exportReportsCsv')?.prepend(icon('download'));
  document.querySelectorAll('#copyQrBtn, #openQrLinkBtn, #downloadQrBtn').forEach(btn => btn.prepend(icon({ copyQrBtn: 'copy', openQrLinkBtn: 'external-link', downloadQrBtn: 'download' }[btn.id])));
  document.querySelectorAll('.login input').forEach(input => {
    input.type = 'password'; input.required = true; input.maxLength = 12;
    const label = document.createElement('label'); label.htmlFor = input.id; label.textContent = input.getAttribute('aria-label');
    input.before(label);
  });
  document.querySelectorAll('.login').forEach(login => {
    const nav = document.createElement('nav'); nav.className = 'login-workspaces'; nav.setAttribute('aria-label', 'Рабочие экраны');
    const selected = document.body.classList.contains('ops-admin') ? '/admin' : document.body.classList.contains('ops-kitchen') ? '/kitchen' : '/staff';
    nav.innerHTML = [['/admin', 'Админ'], ['/staff', 'Зал'], ['/kitchen', 'Кухня']].map(([href, text]) => `<a href="${href}" ${selected === href ? 'aria-current="page"' : ''}>${text}</a>`).join('');
    login.append(nav);
  });
  document.querySelectorAll('[role=tablist] button').forEach(btn => btn.setAttribute('role', 'tab'));
  document.addEventListener('keydown', event => {
    const list = event.target.closest('[role=tablist]');
    if (!list || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...list.querySelectorAll('button:not(:disabled)')];
    const index = tabs.indexOf(event.target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
      (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
  });
  document.querySelectorAll('form').forEach(form => {
    const error = document.createElement('p'); error.className = 'form-error'; error.setAttribute('role', 'alert');
    if (!form.closest('.login')) form.append(error);
    form.addEventListener('input', () => { error.textContent = ''; });
  });
  const focusables = dialog => [...dialog.querySelectorAll('button,a[href],input,select,textarea,summary,[tabindex="0"]')].filter(el => !el.disabled && !el.hidden && el.getClientRects().length);
  function syncDialogs() {
    const next = modals.find(el => el.classList.contains('on')) || null;
    if (next === currentDialog) return;
    if (currentDialog) {
      const opener = openers.get(currentDialog);
      if (opener?.isConnected && opener.getClientRects().length) queueMicrotask(() => opener.focus({ preventScroll: true }));
    }
    currentDialog = next;
    document.body.classList.toggle('ops-dialog-open', Boolean(next));
    document.getElementById('app').inert = Boolean(next);
    if (next) {
      openers.set(next, document.activeElement);
      const panel = next.querySelector('.modal-card, .order-drawer-panel') || next;
      panel.tabIndex = -1;
      queueMicrotask(() => (next.querySelector('input:not([readonly]), select, .x') || panel).focus({ preventScroll: true }));
    }
    for (const modal of modals) modal.setAttribute('aria-hidden', String(modal !== next));
  }
  function isSaving(dialog) { return !!dialog?.querySelector('button[type=submit]:disabled, #confirmCloseTableBtn:disabled, #confirmCancelBtn:disabled, #confirmRotateBtn:disabled'); }
  document.addEventListener('keydown', event => {
    if (!currentDialog) return;
    if (event.key === 'Escape' && isSaving(currentDialog)) { event.preventDefault(); event.stopImmediatePropagation(); }
    if (event.key !== 'Tab') return;
    const nodes = focusables(currentDialog), first = nodes[0], last = nodes[nodes.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
  }, true);
  document.addEventListener('click', event => {
    if (currentDialog && isSaving(currentDialog) && (event.target === currentDialog || event.target.closest('.x, [id^="cancel"], .order-drawer-backdrop'))) {
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    document.querySelectorAll('details.admin-table-menu[open], details.admin-workspaces[open], details.admin-mobile-more[open]').forEach(details => {
      if (!details.contains(event.target) || event.target.closest('button,a')) details.open = false;
    });
  }, true);
  // Polling rebuilds lists; keep expanded orders and keyboard focus stable across those updates.
  const expandedOrders = new Set();
  document.addEventListener('toggle', event => {
    const el = event.target;
    if (el.matches?.('.floor-order-details')) {
      if (el.open) expandedOrders.add(el.dataset.orderId); else expandedOrders.delete(el.dataset.orderId);
    }
  }, true);
  let lastControl = null;
  document.addEventListener('focusin', event => {
    const el = event.target;
    if (el.closest('#tables, #menuDishes, #attentionList, .lane-orders')) lastControl = el;
    else lastControl = null;
  });
  const observer = new MutationObserver(records => {
    if (records.some(r => r.type === 'childList')) {
      document.querySelectorAll('.floor-order-details').forEach(el => { if (expandedOrders.has(el.dataset.orderId)) el.open = true; });
      if (lastControl && !lastControl.isConnected && document.activeElement === document.body) {
        const attrs = ['data-id', 'data-action', 'data-menu-action', 'onclick'];
        const candidates = [...document.querySelectorAll('button')];
        const orderId = lastControl.closest('[data-order-id]')?.dataset.orderId;
        const replacement = candidates.find(el => attrs.every(attr => el.getAttribute(attr) === lastControl.getAttribute(attr)) && attrs.some(attr => lastControl.hasAttribute(attr))) ||
          (orderId ? document.querySelector(`.kitchen-ticket[data-order-id="${orderId}"] .kitchen-primary`) : null);
        if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
      }
      renderIcons();
    }
    if (records.some(r => r.type === 'attributes')) {
      syncDialogs();
      document.querySelectorAll('#adminNav [data-section]').forEach(btn => btn.setAttribute('aria-current', btn.classList.contains('on') ? 'page' : 'false'));
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  renderIcons(); syncDialogs();
  document.addEventListener('submit', event => {
    const form = event.target;
    if (!form.closest('.login')) return;
    const btn = form.querySelector('button');
    if (btn.disabled) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    btn.disabled = true; btn.textContent = 'Подключаемся…';
    const check = setInterval(() => {
      if (typeof refreshBusy !== 'undefined' && refreshBusy) return;
      clearInterval(check); btn.disabled = false; btn.textContent = 'Войти';
    }, 100);
  }, true);
  window.opsFormError = (formId, message) => {
    const form = document.getElementById(formId);
    const error = form?.querySelector('.form-error');
    if (error) { error.textContent = message; error.scrollIntoView({ block: 'nearest', behavior: 'instant' }); }
  };
})();
