const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
for(const name of ['app.js','admin-product.js','ops-product.js','ops-ui.js','sw.js','restaurant-config.js'])new vm.Script(fs.readFileSync(path.join(root,name),'utf8'),{filename:name});
for(const name of ['index.html','admin.html','staff.html','kitchen.html']){
  const source=fs.readFileSync(path.join(root,name),'utf8');for(const match of source.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){if(/src=|application\/ld\+json/.test(match[1]))continue;new vm.Script(match[2],{filename:name});}
}
JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
console.log('Browser scripts, inline handlers and deployment JSON parse successfully.');
