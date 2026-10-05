import {geoContains} from 'd3-geo';
import * as topo from 'topojson-client';
import fs from 'fs';
const w=JSON.parse(fs.readFileSync('node_modules/world-atlas/land-110m.json'));
const land=topo.feature(w,w.objects.land);
const pts=[];
for(let lat=-58;lat<=78;lat+=2.2){
  const step=2.2/Math.max(0.25,Math.cos(lat*Math.PI/180));
  for(let lon=-180;lon<180;lon+=step){ if(geoContains(land,[lon,lat])) pts.push([+lon.toFixed(2),+lat.toFixed(2)]); }
}
// equirect pixel map 192x96
const W=192,H=96,grid=[];
for(let y=0;y<H;y++){let row='';for(let x=0;x<W;x++){const lon=-180+(x+.5)*360/W,lat=90-(y+.5)*180/H;row+=geoContains(land,[lon,lat])?'1':'0';}grid.push(row);}
fs.writeFileSync('assets/globe.js','window.GLOBE='+JSON.stringify(pts)+';window.MAPGRID='+JSON.stringify(grid)+';');
console.log(pts.length);
