const {app,BrowserWindow,shell}=require('electron');
const path=require('path');
// Calidad de render: la app activa el modo alto y usa toda la GPU disponible.
function createWindow(){
  const win=new BrowserWindow({width:1600,height:1000,minWidth:1024,minHeight:700,title:'Alhelí Showroom',backgroundColor:'#2b1d2e',
    titleBarStyle:process.platform==='darwin'?'hiddenInset':'default',
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,sandbox:true}});
  win.loadFile(path.join(__dirname,'app','index.html'),{hash:'edificio'});
  win.webContents.setWindowOpenHandler(({url})=>{shell.openExternal(url);return {action:'deny'}});
  win.once('ready-to-show',()=>win.show());
}
app.whenReady().then(()=>{createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()})});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
