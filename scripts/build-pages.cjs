const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist-pages');
const publicFiles = [
  'index.html', 'menu.html', 'admin.html', 'staff.html', 'kitchen.html', 'offline.html',
  'app.js', 'guest-order-live.js', 'guest-orders.css', 'admin-product.js', 'ops-product.js', 'ops-ui.js', 'restaurant-config.js',
  'styles.css', 'ops.css', 'product-ui.css', 'sw.js', 'ref-products-dom.json'
];
const publicFolders = ['assets', 'fonts', 'icons', 'vendor', 'sushi_crazy_all_photos'];

(async () => {
  // Only named public assets enter the deployment; source, tests and secrets stay out.
  fs.mkdirSync(output, { recursive: true });
  for (const entry of fs.readdirSync(output)) {
    const target = path.resolve(output, entry);
    if (!target.startsWith(output + path.sep)) throw new Error('Unsafe build cleanup path');
    fs.rmSync(target, { recursive: true, force: true });
  }
  for (const file of publicFiles) fs.copyFileSync(path.join(root, file), path.join(output, file));
  for (const dir of publicFolders) fs.cpSync(path.join(root, dir), path.join(output, dir), {
    recursive: true,
    filter: source => !fs.lstatSync(source).isSymbolicLink() && !path.basename(source).startsWith('.')
  });
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  // Pages serves extensionless HTML automatically; rewrites to .html would loop.
  const redirects = [];
  for (const row of vercel.rewrites.filter(row => row.source.startsWith('/apple-emoji/'))) redirects.push(`${row.source} ${row.destination} 302`);
  fs.writeFileSync(path.join(output, '_redirects'), redirects.join('\n') + '\n');
  const headers = vercel.headers.map(row => [row.source.replace(/:path\*/g, '*'), ...row.headers.map(header => `  ${header.key}: ${header.value}`)].join('\n'));
  fs.writeFileSync(path.join(output, '_headers'), headers.join('\n') + '\n');
  fs.writeFileSync(path.join(output, '_routes.json'), JSON.stringify({ version: 1, include: ['/api/*', '/manifest.webmanifest', '/product/*'], exclude: [] }, null, 2));
  await esbuild.build({ entryPoints: [path.join(root, 'cloudflare/worker.js')], outfile: path.join(output, '_worker.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, define: { 'process.env': '{}' } });
  const files = [];
  function inspect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) inspect(file);
      else {
        if (fs.statSync(file).size > 25 * 1024 * 1024) throw new Error('Pages asset exceeds 25 MiB: ' + file);
        files.push(file);
      }
    }
  }
  inspect(output);
  if (files.length > 20000) throw new Error('Pages deployment exceeds 20000 files');
  console.log('Pages build ready: ' + files.length + ' public files in dist-pages.');
})().catch(error => { console.error(error); process.exitCode = 1; });
