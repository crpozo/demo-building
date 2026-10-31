const {contextBridge}=require('electron');
contextBridge.exposeInMainWorld('ALHELI_DESKTOP',{version:process.versions.electron,platform:process.platform});
