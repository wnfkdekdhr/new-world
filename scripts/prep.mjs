import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, weld } from '@gltf-transform/functions';
import fs from 'fs'; import path from 'path';
const io = new NodeIO();
const C = process.env.HOME + '/assets/KayKit-Character-Pack-Adventures-1.0/addons/kaykit_character_pack_adventures/Characters/gltf';
const H = process.env.HOME + '/assets/KayKit-Medieval-Hexagon-Pack-1.0/addons/kaykit_medieval_hexagon_pack/Assets/gltf';
const KEEP = new Set(['Idle','Walking_A','Walking_B','Running_A','Jump_Start','Jump_Idle','Jump_Land','Interact','Cheer','Sit_Floor_Idle','Spellcasting','Spellcast_Raise','Unarmed_Idle','PickUp','Walking_Backwards','Sit_Chair_Idle','Hit_A']);
for (const name of ['Knight','Mage','Barbarian','Rogue_Hooded']) {
  const doc = await io.read(`${C}/${name}.glb`);
  for (const a of doc.getRoot().listAnimations()) if (!KEEP.has(a.getName())) a.dispose();
  await doc.transform(prune(), dedup());
  await io.write(`public/assets/chars/${name}.glb`, doc);
}
const env = {
  'buildings/blue': ['building_tavern_blue','building_home_A_blue','building_home_B_blue','building_windmill_blue','building_church_blue','building_well_blue','building_blacksmith_blue','building_market_blue','building_tower_A_blue','building_watermill_blue','building_castle_blue'],
  'buildings/red': ['building_home_A_red','building_home_B_red'],
  'buildings/neutral': ['building_bridge_A','fence_wood_straight','fence_stone_straight','wall_straight','building_destroyed','building_grain','building_stage_C'],
  'decoration/nature': ['tree_single_A','tree_single_B','trees_A_large','trees_A_medium','trees_B_large','trees_B_medium','trees_A_small','rock_single_A','rock_single_B','rock_single_C','rock_single_D','rock_single_E','mountain_A_grass_trees','mountain_B_grass_trees','mountain_C_grass','mountain_A','mountain_B','hill_single_A','cloud_big','cloud_small','waterlily_A','waterplant_A'],
  'decoration/props': ['barrel','crate_A_big','crate_B_small','sack','tent','weaponrack','wheelbarrow','flag_blue','bucket_water','resource_lumber','target','ladder'],
};
for (const [dir, list] of Object.entries(env)) for (const n of list) {
  const f = `${H}/${dir}/${n}.gltf`; if (!fs.existsSync(f)) { console.log('missing', f); continue; }
  const doc = await io.read(f); await doc.transform(dedup(), prune());
  await io.write(`public/assets/env/${n}.glb`, doc);
}
console.log('done');
