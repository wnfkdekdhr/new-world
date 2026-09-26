// Rewrites every dist .glb as a self-contained .json glTF (buffers and images as data URIs)
import { NodeIO } from '@gltf-transform/core';
import fs from 'fs'; import path from 'path';
const io = new NodeIO();
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
for (const f of walk(process.argv[2]).filter((f) => f.endsWith('.glb'))) {
  const doc = await io.read(f);
  const { json, resources } = await io.writeJSON(doc, { format: 'json' });
  const mime = (u) => u.endsWith('.png') ? 'image/png' : u.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream';
  for (const b of json.buffers || []) if (b.uri && resources[b.uri]) b.uri = `data:${mime(b.uri)};base64,` + Buffer.from(resources[b.uri]).toString('base64');
  for (const im of json.images || []) if (im.uri && resources[im.uri]) im.uri = `data:${mime(im.uri)};base64,` + Buffer.from(resources[im.uri]).toString('base64');
  fs.writeFileSync(f.replace(/\.glb$/, '.json'), JSON.stringify(json));
  fs.unlinkSync(f);
}
