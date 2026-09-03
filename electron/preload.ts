import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('mimora', {
  appName: 'Mimora',
});
