(() => {
  const escape=h;
  function dialog(id,title){const el=document.createElement('dialog');el.className='product-dialog';el.id=id;el.setAttribute('aria-label',title);document.body.append(el);return el;}
  function iconButton(icon,title,fn){const b=document.createElement('button');b.type='button';b.className='product-button product-icon';b.title=title;b.setAttribute('aria-label',title);b.innerHTML='<i data-lucide="'+icon+'"></i>';b.onclick=fn;return b;}
  const settingsDialog=document.getElementById('restaurantSettings'),inbox=dialog('incidentInbox','Уведомления'),importDialog=dialog('menuImport','Импорт меню');
  let settingsLoaded=false,settingsLoading=false,settingsDirty=false,pinDirty=false,settingsSaving=false,pinSaving=false,settingsRevision=0,pinRevision=0;
  const paymentDialog=dialog('adminPayment','Подтверждение оплаты');
  window.openAdminPayment=id=>{
    const o=orderState?.orders.find(o=>Number(o.id)===Number(id));if(!o||o.paid_at||o.status==='cancelled')return;
    closeOrderDrawer();paymentDialog.innerHTML='<h2>Оплата заказа #'+Number(id)+'</h2><p>'+money(o.total)+'</p><form><label>Способ оплаты<select name="paymentMethod"><option value="cash">Наличные</option><option value="card">Карта</option><option value="kaspi">Kaspi</option></select></label><p class="product-error"></p><div class="product-actions"><button type="button" id="cancelAdminPayment">Назад</button><button class="primary" type="submit">Оплата получена</button></div></form>';
    paymentDialog.querySelector('select').value=o.payment_method;paymentDialog.querySelector('#cancelAdminPayment').onclick=()=>paymentDialog.close();paymentDialog.querySelector('form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('[type=submit]');button.disabled=true;try{const response=await fetch(STAFF_API,{method:'POST',headers:{'Content-Type':'application/json','x-staff-role':'admin','x-staff-pin':pin,'x-device-id':ProductDevice},body:JSON.stringify({action:'confirm-payment',orderId:Number(id),paymentMethod:e.target.elements.paymentMethod.value}),signal:AbortSignal.timeout(12000)});const result=await response.json();if(!response.ok)throw new Error(result.error);paymentDialog.close();await loadOrders(false,true);await refreshProduct();notify('Оплата подтверждена');}catch(e){paymentDialog.querySelector('.product-error').textContent=e.message;}finally{button.disabled=false;}};paymentDialog.showModal();
  };
  const top=document.querySelector('.admin-top-actions');

  const bell=iconButton('bell','Уведомления администратора',openInbox);top.prepend(bell);
  const fieldNames={restaurant_name:'Название',subtitle:'Описание',city:'Город',schedule_open:'Открытие',schedule_close:'Закрытие',phone_number:'Телефон',whatsapp_number:'WhatsApp',address_text:'Адрес',map_url:'Ссылка на карту',instagram_url:'Instagram',canonical_url:'Адрес сайта',logo_url:'Логотип',banner_url:'Обложка'};
  window.loadRestaurantSettings=async(force=false)=>{
    if(!pin||settingsLoading||(!force&&settingsLoaded))return;
    if(settingsSaving||pinSaving){notify('Сохранение ещё выполняется');return;}
    if(force&&(settingsDirty||pinDirty)){notify('Сначала сохраните изменения в настройках');return;}
    const revision=settingsRevision+pinRevision;
    settingsLoading=true;settingsDialog.setAttribute('aria-busy','true');document.getElementById('retrySettings').hidden=true;
    try{
      const {settings:s}=await api('settings');
      if(settingsLoaded&&(revision!==settingsRevision+pinRevision||settingsDirty||pinDirty||settingsSaving||pinSaving))return;
      const fields=keys=>'<div class="product-grid">'+keys.map(key=>'<label>'+fieldNames[key]+'<input name="'+key+'" value="'+escape(s[key]||'')+'" '+(key==='restaurant_name'?'required':'')+'></label>').join('')+'</div>';
      settingsDialog.innerHTML='<form class="product-form" id="restaurantForm">'+
        '<fieldset class="settings-group"><legend>Ресторан</legend>'+fields(['restaurant_name','subtitle','city','address_text','schedule_open','schedule_close','phone_number','whatsapp_number','map_url','instagram_url'])+'</fieldset>'+
        '<fieldset class="settings-group"><legend>Оформление меню</legend>'+fields(['logo_url','banner_url'])+'<div class="product-actions"><button class="product-button" id="uploadLogo" type="button">Загрузить логотип</button><button class="product-button" id="uploadBanner" type="button">Загрузить обложку</button></div></fieldset>'+
        '<fieldset class="settings-group"><legend>Публикация</legend><p class="settings-description">Меню для просмотра открывается по общей ссылке. Заказы гости оформляют по QR-коду на столе.</p>'+fields(['canonical_url'])+'<label>Часовой пояс<input name="timezone" value="'+escape(s.timezone||'Asia/Qyzylorda')+'" required></label><label class="choice"><input name="public_menu_enabled" type="checkbox" '+(s.public_menu_enabled?'checked':'')+'>Разрешить просмотр без QR</label><a href="/?view=menu" target="_blank" rel="noopener">Открыть меню для просмотра ↗</a></fieldset>'+
        '<p class="product-error" id="settingsError" role="alert"></p><p id="settingsFeedback" role="status"></p><div class="product-actions"><button class="primary" type="submit">Сохранить настройки</button><button type="button" id="settingsCancel">На главную</button></div></form>'+
        '<section class="settings-section"><h2>Доступ сотрудников</h2><p class="settings-description">У каждой роли свой общий PIN. Действия учитываются по роли и устройству.</p><form id="rolePinForm" class="product-form"><label>Роль<select name="role"><option value="admin">Администратор</option><option value="waiter">Официант</option><option value="kitchen">Кухня</option></select></label><label>Новый общий PIN<input name="newPin" type="password" inputmode="numeric" pattern="[0-9]{1,12}" maxlength="12" required autocomplete="new-password"></label><button class="product-button" type="submit">Изменить PIN</button><p class="product-error" id="pinError" role="alert"></p></form></section>';
      const form=settingsDialog.querySelector('#restaurantForm');
      const markSettingsDirty=()=>{settingsDirty=true;settingsRevision++;document.getElementById('settingsFeedback').textContent='Есть несохранённые изменения';};
      form.addEventListener('input',markSettingsDirty);form.addEventListener('change',markSettingsDirty);
      const pinForm=settingsDialog.querySelector('#rolePinForm');
      const markPinDirty=()=>{pinDirty=true;pinRevision++;};
      pinForm.addEventListener('input',markPinDirty);pinForm.addEventListener('change',markPinDirty);
      settingsDialog.querySelector('#settingsCancel').onclick=()=>switchSection('overview');
      form.onsubmit=async e=>{
        e.preventDefault();if(settingsSaving)return;settingsSaving=true;
        const savedRevision=settingsRevision,button=form.querySelector('[type=submit]');button.disabled=true;document.getElementById('settingsError').textContent='';
        try{
          const values=Object.fromEntries(new FormData(form));values.public_menu_enabled=form.elements.public_menu_enabled.checked;
          await api('save-settings',{settings:values});settingsDirty=settingsRevision!==savedRevision;document.getElementById('settingsFeedback').textContent=settingsDirty?'Есть несохранённые изменения':'Настройки сохранены';
          window.RestaurantName=values.restaurant_name;document.querySelectorAll('.admin-brand b,.admin-mobile-menu-head b').forEach(el=>el.textContent=values.restaurant_name);document.title=values.restaurant_name+' · Администратор';notify(settingsDirty?'Отправленные настройки сохранены. Новый черновик ещё не сохранён':'Настройки сохранены');
        }catch(e){document.getElementById('settingsError').textContent=e.message;}
        finally{settingsSaving=false;button.disabled=false;}
      };
      pinForm.onsubmit=async e=>{
        e.preventDefault();if(pinSaving)return;pinSaving=true;
        const values=Object.fromEntries(new FormData(pinForm)),controls=[...pinForm.elements];controls.forEach(el=>el.disabled=true);settingsDialog.querySelector('#pinError').textContent='';
        try{await api('set-role-pin',values);if(values.role==='admin'){pin=values.newPin;sessionStorage.setItem('sushi-admin-pin',pin);}pinForm.reset();pinDirty=false;notify('PIN изменён');}
        catch(e){settingsDialog.querySelector('#pinError').textContent=e.message;}finally{pinSaving=false;controls.forEach(el=>el.disabled=false);}
      };
      settingsDialog.querySelector('#uploadLogo').onclick=()=>choosePhoto(form.elements.logo_url,settingsDialog.querySelector('#settingsError'));
      settingsDialog.querySelector('#uploadBanner').onclick=()=>choosePhoto(form.elements.banner_url,settingsDialog.querySelector('#settingsError'));
      settingsLoaded=true;settingsDirty=false;pinDirty=false;
    }catch(e){if(e.status===401){settingsLoaded=false;sessionStorage.removeItem('sushi-admin-pin');pin='';stopPolling();document.getElementById('login').hidden=false;document.getElementById('app').hidden=true;}
      if(!settingsLoaded)settingsDialog.innerHTML='<p class="product-error" role="alert">'+escape(e.message)+'</p>';else notify(e.message);document.getElementById('retrySettings').hidden=false;}
    finally{settingsLoading=false;settingsDialog.setAttribute('aria-busy','false');}
  };
  document.getElementById('retrySettings').onclick=()=>window.loadRestaurantSettings(true);
  if(pin&&currentSection==='settings')window.loadRestaurantSettings();
  async function openInbox(){
    try{const {incidents:rows}=await api('incidents');
      inbox.innerHTML='<h2>Уведомления</h2><div class="product-list">'+(rows.length?rows.map(r=>'<article><b>'+escape(r.message)+'</b><small>'+escape(r.source)+' · '+escape(new Date(r.last_seen_at).toLocaleString('ru-RU'))+' · '+r.occurrences+'</small>'+(r.resolved_at?'<small>Решено</small>':'<button class="product-button" data-resolve="'+r.id+'" type="button">Отметить решённым</button>')+'</article>').join(''):'<p>Сбоев не зарегистрировано</p>')+'</div><div class="product-actions"><button type="button" id="closeInbox">Закрыть</button></div>';
      inbox.querySelector('#closeInbox').onclick=()=>inbox.close();inbox.querySelectorAll('[data-resolve]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('resolve-incident',{id:Number(b.dataset.resolve)});b.textContent='Решено';}catch(e){b.disabled=false;notify(e.message);}});if(!inbox.open)inbox.showModal();
    }catch(e){notify(e.message);}
  }
  const reports=document.createElement('section');reports.className='product-section';reports.id='paidReports';document.getElementById('pageReports').prepend(reports);
  async function refreshProduct(){
    if(!pin||document.getElementById('app').hidden||document.hidden)return;
    try{
      const [{financial:f},{incidents:rows}]=await Promise.all([api('financial'),api('incidents')]);
      paidFinancial=f;renderStats(state?.analytics||{});
      const count=rows.filter(r=>!r.resolved_at).length;bell.title='Уведомления'+(count?' · '+count:'');bell.setAttribute('aria-label',bell.title);bell.style.color=count?'#a51c30':'';
      const current=f.shifts.find(s=>!s.closed_at);
      reports.innerHTML='<h2>Подтверждённые оплаты</h2><div class="product-metrics"><div><span>Выручка · 30 дней</span><b>'+money(f.paid30)+'</b><small>'+f.paidOrders30+' оплаченных заказов</small></div><div><span>Выручка · 24 часа</span><b>'+money(f.paid24)+'</b></div><div><span>Средний оплаченный заказ</span><b>'+money(f.averagePaidCheck)+'</b></div><div><span>Не оплачено</span><b>'+money(f.unpaidTotal)+'</b><small>'+f.unpaidOrders+' заказов · '+f.unpaidTables+' столов</small></div></div><section class="product-section"><h2>Ежедневная смена</h2><p>'+(current?'Открыта '+escape(new Date(current.opened_at).toLocaleString('ru-RU'))+' · '+money(f.shiftPaid):'Нет открытой смены')+'</p><div class="product-list">'+f.shifts.filter(s=>s.closed_at).slice(0,7).map(s=>'<article>'+escape(new Date(s.opened_at).toLocaleDateString('ru-RU'))+' · '+money(s.summary?.paid||0)+' · '+Number(s.summary?.orders||0)+' заказов</article>').join('')+'</div></section><section class="product-section"><h2>Действия по ролям · 30 дней</h2><div class="product-metrics">'+f.roles.map(r=>'<div><span>'+({admin:'Администратор',waiter:'Официант',kitchen:'Кухня'}[r.role])+'</span><b>'+r.actions+'</b><small>Оплат: '+r.payments+'</small></div>').join('')+'</div></section>';
    }catch(_){reports.innerHTML='<p class="product-error">Не удалось обновить данные оплат</p>';}
  }
  setInterval(refreshProduct,15000);setTimeout(refreshProduct,1200);document.addEventListener('visibilitychange',refreshProduct);document.getElementById('loginForm').addEventListener('submit',()=>setTimeout(refreshProduct,1000));
  function choosePhoto(target,error){
    const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';
    input.onchange=async()=>{const file=input.files[0];if(!file)return;error.textContent='Загружаем фото…';try{
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5242880)throw new Error('JPG, PNG или WebP, до 5 МБ');
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Не удалось прочитать фото'));reader.readAsDataURL(file);});
      const result=await api('upload-image',{mime:file.type,data});target.value=result.url;target.dispatchEvent(new Event('input',{bubbles:true}));error.textContent='';
    }catch(e){error.textContent=e.message;}};input.click();
  }
  const photoButton=document.createElement('button');photoButton.type='button';photoButton.className='product-button';photoButton.innerHTML='<i data-lucide="image-up"></i> Загрузить фото';document.getElementById('dishImage').parentElement.append(photoButton);
  const photoError=document.createElement('p');photoError.className='product-error';photoButton.after(photoError);photoButton.onclick=()=>choosePhoto(document.getElementById('dishImage'),photoError);
  let groups=[];const options=document.createElement('details');options.className='product-section';options.innerHTML='<summary>Варианты и добавки</summary><div id="modifierEditor"></div><button class="product-button" type="button" id="addModifierGroup"><i data-lucide="plus"></i> Группа</button>';document.getElementById('dishForm').append(options);
  function renderGroups(){
    options.querySelector('#modifierEditor').innerHTML=groups.map((g,i)=>'<div class="product-option-group" data-group="'+i+'"><div class="product-grid"><label>Группа<input data-field="name" value="'+escape(g.name)+'" required maxlength="80"></label><div class="product-grid"><label>Минимум<input data-field="min" type="number" value="'+g.min+'" min="0" max="20"></label><label>Максимум<input data-field="max" type="number" value="'+g.max+'" min="1" max="20"></label></div></div><div>'+g.options.map((o,j)=>'<div class="product-option-row" data-option="'+j+'"><label>Вариант<input data-field="name" value="'+escape(o.name)+'" required maxlength="80"></label><label>Доплата<input data-field="price_delta" type="number" min="0" max="1000000" value="'+o.price_delta+'"></label><input data-field="is_available" type="checkbox" '+(o.is_available?'checked':'')+' aria-label="Доступен"><button class="product-button product-icon" data-remove-option="'+j+'" type="button" title="Удалить вариант" aria-label="Удалить вариант"><i data-lucide="trash-2"></i></button></div>').join('')+'</div><div class="product-actions"><button class="product-button" data-add-option type="button"><i data-lucide="plus"></i> Вариант</button><button class="product-button product-icon" data-remove-group type="button" aria-label="Удалить группу" title="Удалить группу"><i data-lucide="trash-2"></i></button></div></div>').join('');window.lucide?.createIcons();
  }
  window.readDishGroups=()=>{options.querySelectorAll('[data-group]').forEach(el=>{const g=groups[Number(el.dataset.group)];el.querySelectorAll(':scope>.product-grid [data-field]').forEach(input=>g[input.dataset.field]=input.type==='number'?Number(input.value):input.value);el.querySelectorAll('[data-option]').forEach(row=>{const o=g.options[Number(row.dataset.option)];row.querySelectorAll('input').forEach(input=>o[input.dataset.field]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value);});});return groups;};
  window.loadDishGroups=input=>{groups=structuredClone(input||[]);options.open=false;renderGroups();};
  options.querySelector('#addModifierGroup').onclick=()=>{window.readDishGroups();if(groups.length>=12){notify('Не больше 12 групп');return;}groups.push({id:crypto.randomUUID(),name:'',min:0,max:1,options:[{id:crypto.randomUUID(),name:'',price_delta:0,is_available:true}]});renderGroups();};
  options.addEventListener('click',e=>{const b=e.target.closest('button'),el=b?.closest('[data-group]');if(!el)return;window.readDishGroups();const g=groups[Number(el.dataset.group)];if(b.hasAttribute('data-add-option'))g.options.push({id:crypto.randomUUID(),name:'',price_delta:0,is_available:true});else if(b.hasAttribute('data-remove-option'))g.options.splice(Number(b.dataset.removeOption),1);else if(b.hasAttribute('data-remove-group'))groups.splice(Number(el.dataset.group),1);else return;renderGroups();});
  const importButton=document.createElement('button');importButton.type='button';importButton.className='product-button';importButton.innerHTML='<i data-lucide="file-spreadsheet"></i> Excel';document.querySelector('.menu-admin-toolbar').append(importButton);
  importButton.onclick=()=>{
    importDialog.innerHTML='<h2>Импорт меню</h2><input type="file" id="menuWorkbook" accept=".xlsx"><div id="importPreview"></div><p class="product-error" id="importError"></p><div class="product-actions"><button type="button" id="cancelImport">Закрыть</button><button type="button" id="confirmImport" class="primary" disabled>Добавить блюда</button></div>';
    let rows=[],importId=crypto.randomUUID();importDialog.querySelector('#cancelImport').onclick=()=>importDialog.close();
    const error=importDialog.querySelector('#importError'),submit=importDialog.querySelector('#confirmImport');
    importDialog.querySelector('#menuWorkbook').onchange=async e=>{submit.disabled=true;error.textContent='Читаем таблицу…';try{
      const file=e.target.files[0];if(!file||file.size>5242880)throw new Error('Файл XLSX до 5 МБ');const sheet=await window.readMenuSheet(file);if(sheet.length<2||sheet.length>501)throw new Error('Таблица должна содержать от 1 до 500 блюд');
      const aliases={название:'name',name:'name',категория:'category',category:'category',цена:'price',price:'price',вес:'weight',weight:'weight',описание:'description',description:'description',фото:'image_url',image_url:'image_url',доступно:'is_available',is_available:'is_available'};
      const headers=sheet[0].map(v=>aliases[String(v||'').trim().toLowerCase()]);for(const key of ['name','category','price'])if(!headers.includes(key))throw new Error('Обязательные колонки: Название, Категория, Цена');
      rows=sheet.slice(1).filter(r=>r.some(v=>v!==null&&v!=='')).map((r,i)=>{const row={};headers.forEach((key,j)=>{if(key)row[key]=r[j];});row.name=String(row.name||'').trim();row.category=String(row.category||'').trim();row.price=Number(row.price);row.is_available=!['нет','false','0'].includes(String(row.is_available).toLowerCase());if(!row.name||!row.category||!Number.isInteger(row.price)||row.price<0||row.price>1000000)throw new Error('Проверьте строку '+(i+2));return row;});if(!rows.length)throw new Error('Нет блюд для импорта');
      importDialog.querySelector('#importPreview').innerHTML='<h3>Будет добавлено: '+rows.length+'</h3><div class="product-list">'+rows.slice(0,10).map(r=>'<article><b>'+escape(r.name)+'</b><small>'+escape(r.category)+' · '+money(r.price)+'</small></article>').join('')+'</div>';error.textContent='';submit.disabled=false;
    }catch(e){rows=[];error.textContent=e.message;}};
    submit.onclick=async()=>{submit.disabled=true;try{const result=await api('import-menu',{rows,importId});importDialog.close();await loadMenu(false,true);notify('Добавлено блюд: '+result.imported);}catch(e){error.textContent=e.message;submit.disabled=false;}};importDialog.showModal();
  };
  window.lucide?.createIcons();
})();
