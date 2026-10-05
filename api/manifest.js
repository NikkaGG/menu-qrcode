const {restaurantSettings}=require('../lib/server-config.cjs');
module.exports=async(req,res)=>{
  let settings={};try{settings=await restaurantSettings();}catch(_){}
  res.setHeader('Content-Type','application/manifest+json');res.setHeader('Cache-Control','no-cache');
  res.end(JSON.stringify({id:'/',name:settings.restaurant_name||'Menu-QR',short_name:settings.restaurant_name||'Menu-QR',start_url:'/',scope:'/',display:'standalone',background_color:'#ffffff',theme_color:'#ffffff',icons:settings.logo_url?[{src:settings.logo_url,sizes:'any',purpose:'any'}]:[{src:'/icons/app-192.png',sizes:'192x192',type:'image/png'},{src:'/icons/app-512.png',sizes:'512x512',type:'image/png'}]}));
};
