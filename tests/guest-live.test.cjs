const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const load=require('../scripts/edge-loader.cjs');
const vm=require('node:vm');
const fs=require('node:fs');
const guestSource=fs.readFileSync(path.resolve(__dirname,'../app.js'),'utf8');
function orderProgress(status){
  const context=vm.createContext({});
  vm.runInContext(guestSource.slice(guestSource.indexOf('function tableStatusStep('),guestSource.indexOf('function tableOrderItemsMarkup(')),context);
  return context.tableOrderStatusMarkup({status});
}
test('served orders no longer present an in-progress delivery timeline',()=>{
  assert.equal(orderProgress('served'),'');
});
test('an active order shows its current stage and cancellation has no delivery timeline',()=>{
  const preparing=orderProgress('preparing');
  assert.match(preparing,/<div class="table-status-step done active"><i[^>]*><\/i><span>Готовится<\/span>/);
  assert.equal((preparing.match(/class="table-status-step /g)||[]).length,5);
  assert.match(orderProgress('cancelled'),/Заказ отменён/);
  assert.doesNotMatch(orderProgress('cancelled'),/table-status-steps/);
});
test('a status request started before checkout cannot erase the newly placed order',async()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../app.js'),'utf8');
  const fn=source.slice(source.indexOf('async function refreshTableStatus('),source.indexOf('async function requestTableService('));
  let release;
  const state={ready:true,loading:false,statusLoading:false,orders:[],session:null,stateVersion:0};
  const context=vm.createContext({tableOrdering:state,tableApiCall:()=>new Promise(resolve=>{release=resolve;}),applyTableOrderState:data=>{state.orders=data.orders;state.session=data.session;},renderTableOrderPanel(){},updateOrderState(){},showToast(){},setTimeout(){},guestApiErrorMessage:()=>'',console});
  vm.runInContext(fn,context);
  const pending=vm.runInContext('refreshTableStatus(false)',context);
  state.stateVersion++;state.orders=[{id:1001,status:'submitted'}];state.session={id:'new-session'};
  release({orders:[],session:null});await pending;
  assert.deepEqual(state.orders,[{id:1001,status:'submitted'}]);
  assert.deepEqual(state.session,{id:'new-session'});
});
test('a failed pre-checkout status request cannot invalidate the new session',async()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../app.js'),'utf8');
  const fn=source.slice(source.indexOf('async function refreshTableStatus('),source.indexOf('async function requestTableService('));
  let reject;
  const state={ready:true,loading:false,statusLoading:false,orders:[],session:null,stateVersion:0};
  const context=vm.createContext({tableOrdering:state,tableApiCall:()=>new Promise((_,fail)=>{reject=fail;}),renderTableOrderPanel(){},updateOrderState(){},stopTableLive(){},stopTablePolling(){},showToast(){},setTimeout(){},guestApiErrorMessage:()=> 'Session expired',console});
  vm.runInContext(fn,context);
  const pending=vm.runInContext('refreshTableStatus(false)',context);
  state.stateVersion++;state.orders=[{id:1001,status:'submitted'}];state.session={id:'new-session'};
  reject(Object.assign(new Error('Session expired'),{status:409}));await pending;
  assert.equal(state.ready,true);
  assert.deepEqual(state.session,{id:'new-session'});
});
test('order broadcasts are scoped to the QR table and contain no guest or order data',async()=>{
  const sent=[];
  const api=load(path.resolve(__dirname,'../supabase/functions/_shared/product.ts'),{
    Deno:{env:{get:key=>({SUPABASE_URL:'https://restaurant.example',SUPABASE_SERVICE_ROLE_KEY:'server-secret'})[key]}},
    fetch:async(url,init)=>{
      if(url.includes('/table_sessions?'))return Response.json([{table_id:'table-one'}]);
      if(url.includes('/restaurant_tables?'))return Response.json([{qr_token:'qr-capability'}]);
      sent.push({url,init});return new Response(null,{status:202});
    },Response,AbortSignal,console
  });
  await api.broadcastTableChange('session-one');
  assert.equal(sent.length,1);
  assert.equal(sent[0].url,'https://restaurant.example/realtime/v1/api/broadcast');
  assert.equal(sent[0].init.headers.apikey,'server-secret');
  assert.deepEqual(JSON.parse(sent[0].init.body),{messages:[{topic:'table-orders:qr-capability',event:'order-changed',payload:{},private:false}]});
});
test('disabled or missing tables do not broadcast',async()=>{
  let broadcast=0;
  const api=load(path.resolve(__dirname,'../supabase/functions/_shared/product.ts'),{
    Deno:{env:{get:key=>({SUPABASE_URL:'https://restaurant.example',SUPABASE_SERVICE_ROLE_KEY:'server-secret'})[key]}},
    fetch:async(url)=>{if(url.includes('/realtime/'))broadcast++;return Response.json(url.includes('/table_sessions?')?[{table_id:'disabled-table'}]:[]);},Response,AbortSignal,console
  });
  await api.broadcastTableChange('session-one');assert.equal(broadcast,0);
});

