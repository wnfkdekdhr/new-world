// Rewrites every dist .glb as a .json file holding the GLB bytes in base64 (see fetchModel in src/world.js)
import fs from 'fs'; import path from 'path';
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
for (const f of walk(process.argv[2]).filter((f) => f.endsWith('.glb'))) {
  fs.writeFileSync(f.replace(/\.glb$/, '.json'), JSON.stringify({ glb: fs.readFileSync(f).toString('base64') }));
  fs.unlinkSync(f);
}
