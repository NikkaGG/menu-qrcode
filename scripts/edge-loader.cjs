const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
module.exports=function loadEdge(entry,globals){
  const context=vm.createContext(globals),cache=new Map();
  function load(file){
    if(cache.has(file))return cache.get(file).exports;
    const module={exports:{}};cache.set(file,module);
    const source=fs.readFileSync(file,'utf8');
    const compiled=ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});
    const wrapper=vm.runInContext('(function(require,module,exports){'+compiled+'\n})',context,{filename:file});
    wrapper(specifier=>{if(!specifier.startsWith('.'))throw new Error('External modules are disabled in isolated preview');return load(path.resolve(path.dirname(file),specifier));},module,module.exports);
    return module.exports;
  }
  return load(entry);
};
