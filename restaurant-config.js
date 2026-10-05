// Public installation settings. Never put server keys or PINs here.
const MenuPublicConfig = Object.freeze({
  supabaseUrl: 'https://gelezvudpcsnhqgjaqkl.supabase.co',
  publishableKey: 'sb_publishable_w24dlBQIlqYyQwY-6bJPmw_KNa-FCRK'
});
if(typeof window!=='undefined')window.MenuConfig=MenuPublicConfig;
if(typeof module!=='undefined')module.exports=MenuPublicConfig;
