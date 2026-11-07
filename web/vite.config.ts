import {defineConfig} from 'vite';
export default defineConfig({server:{proxy:{'/api':'http://localhost:3001','/manifest.webmanifest':'http://localhost:3001'}}});
