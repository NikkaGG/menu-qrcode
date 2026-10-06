const defaults=require('../restaurant-config.js');
exports.configFor=(env={})=>({supabaseUrl:env.MENU_SUPABASE_URL||defaults.supabaseUrl,publishableKey:env.MENU_SUPABASE_PUBLISHABLE_KEY||defaults.publishableKey});
exports.config=exports.configFor(typeof process==='undefined'?{}:process.env);
exports.restaurantSettings=async(config=exports.config)=>{
  const {supabaseUrl,publishableKey}=config;
  const response=await fetch(supabaseUrl+'/rest/v1/site_settings?select=*&id=eq.1&limit=1',{headers:{apikey:publishableKey},signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error('Restaurant settings unavailable');return (await response.json())[0]||{};
};
