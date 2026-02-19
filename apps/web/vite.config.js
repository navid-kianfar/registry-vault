import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@registryvault/shared': path.resolve(__dirname, '../../packages/shared/src'),
        },
    },
    server: {
        port: 3000,
    },
});
//# sourceMappingURL=vite.config.js.map