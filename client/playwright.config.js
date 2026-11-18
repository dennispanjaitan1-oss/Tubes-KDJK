import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests',workers:1,timeout:120000,globalTimeout:150000,
  reporter:[['list'],['json',{outputFile:'test-results/results.json'}]],
  use:{baseURL:'http://localhost:5174',headless:true,channel:'chrome',actionTimeout:10000,launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']},trace:'retain-on-failure'},
  webServer:[
    {command:'node src/index.js',cwd:'../server',url:'http://localhost:4010/api/health',env:{PORT:'4010',CLIENT_ORIGIN:'http://localhost:5174'},reuseExistingServer:false},
    {command:'node node_modules/vite/bin/vite.js --host localhost --port 5174 --strictPort',url:'http://localhost:5174',env:{VITE_API_URL:'http://localhost:4010'},reuseExistingServer:false}
  ]
});
