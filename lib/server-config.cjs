const defaults=require('../restaurant-config.js');
exports.config={supabaseUrl:process.env.MENU_SUPABASE_URL||defaults.supabaseUrl,publishableKey:process.env.MENU_SUPABASE_PUBLISHABLE_KEY||defaults.publishableKey};
exports.restaurantSettings=async()=>{
  const {supabaseUrl,publishableKey}=exports.config;
  const response=await fetch(supabaseUrl+'/rest/v1/site_settings?select=*&id=eq.1&limit=1',{headers:{apikey:publishableKey},signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error('Restaurant settings unavailable');return (await response.json())[0]||{};
};
