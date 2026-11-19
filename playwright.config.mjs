import {defineConfig} from '@playwright/test';
import {PORT, BASE_URL} from './tests/helpers.mjs';

export default defineConfig({
    testDir:'tests',
    fullyParallel:true,
    reporter:'list',
    use:{
        baseURL:BASE_URL,
        viewport:{width:1200, height:800}
    },
    projects:[{name:'chromium', use:{browserName:'chromium'}}],
    webServer:{
        command:'node tests/server.mjs ' + PORT,
        url:BASE_URL + '/index.html',
        reuseExistingServer:!process.env.CI
    }
});
