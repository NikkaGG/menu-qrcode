const {config}=require('../lib/server-config.cjs');
module.exports=(req,res,installation=config)=>{res.setHeader('Content-Type','application/javascript; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end('window.MenuConfig=Object.freeze('+JSON.stringify({supabaseUrl:installation.supabaseUrl,publishableKey:installation.publishableKey}).replace(/</g,'\\u003c')+');');};
