// Copia la web (index.html, imágenes, modelos y la experiencia interactiva) dentro de la app antes de empaquetar.
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..'),out=path.join(__dirname,'app');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
fs.copyFileSync(path.join(root,'index.html'),path.join(out,'index.html'));
for(const d of ['img','models','experiencia']){fs.cpSync(path.join(root,d),path.join(out,d),{recursive:true});}
console.log('app preparada en',out);
// Si hay credenciales de Apple en el entorno (CI), activa la notarización.
if(process.env.APPLE_ID&&process.env.APPLE_APP_SPECIFIC_PASSWORD&&process.env.APPLE_TEAM_ID){
  const pj=path.join(__dirname,'package.json');const j=JSON.parse(fs.readFileSync(pj,'utf8'));j.build.mac.notarize=true;fs.writeFileSync(pj,JSON.stringify(j,null,2));console.log('notarización activada');
}
