// Turns dist/index.html into a single self-contained page body (JS inlined) for artifact hosting
import fs from 'fs';
const html = fs.readFileSync((process.argv[3]||'dist') + '/index.html', 'utf8');
const jsFile = html.match(/src="\.\/(assets\/index-[^"]+\.js)"/)[1];
const js = fs.readFileSync((process.argv[3]||'dist') + '/' + jsFile, 'utf8').replace(/<\/script/gi, '<\\/script');
const head = html.slice(html.indexOf('<title>'), html.indexOf('</head>')).replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/, '');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/, '');
const out = process.argv[2];
fs.writeFileSync(out, head + body + '<script type="module">' + js + '</script>\n');
console.log('wrote', out, (fs.statSync(out).size / 1024).toFixed(0) + 'KB');
