// Copies the web app (unchanged) into www/ for Capacitor. GitHub Pages keeps serving the repo root.
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..'),out=path.join(root,'www');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out);
for(const f of ['index.html','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png'])fs.copyFileSync(path.join(root,f),path.join(out,f));
fs.cpSync(path.join(root,'fonts'),path.join(out,'fonts'),{recursive:true});
console.log('www/ ready');
