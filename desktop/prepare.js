// Copia la web (index.html, imágenes y modelos) dentro de la app antes de empaquetar.
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..'),out=path.join(__dirname,'app');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
fs.copyFileSync(path.join(root,'index.html'),path.join(out,'index.html'));
for(const d of ['img','models']){fs.cpSync(path.join(root,d),path.join(out,d),{recursive:true});}
console.log('app preparada en',out);
