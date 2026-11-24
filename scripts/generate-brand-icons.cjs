const {app, BrowserWindow, nativeImage}=require('electron');
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..','assets');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:512,height:512,useContentSize:true,transparent:true,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false}});
 const svg=fs.readFileSync(path.join(root,'logo.svg'),'utf8');
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<html><body style="margin:0;background:transparent">'+svg+'</body></html>'));
 await new Promise(r=>setTimeout(r,500));
 const image=await win.webContents.capturePage();
 const png=n=>image.resize({width:n,height:n,quality:'best'}).toPNG();
 fs.writeFileSync(path.join(root,'icon.png'),png(512));
 for(const n of [16,32,48,64,128,256]) fs.writeFileSync(path.join(root,'icon-'+n+'.png'),png(n));
 const sizes=[16,24,32,48,64,128,256], entries=sizes.map(n=>({n,data:png(n)}));
 const header=Buffer.alloc(6+16*entries.length); header.writeUInt16LE(1,2); header.writeUInt16LE(entries.length,4);
 let offset=header.length;
 entries.forEach(({n,data},i)=>{const p=6+i*16;header[p]=n===256?0:n;header[p+1]=header[p];header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(data.length,p+8);header.writeUInt32LE(offset,p+12);offset+=data.length;});
 fs.writeFileSync(path.join(root,'icon.ico'),Buffer.concat([header,...entries.map(e=>e.data)]));
 console.log('Generated PNG and multi-resolution Windows ICO assets');win.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1)});