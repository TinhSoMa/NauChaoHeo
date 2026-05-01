const path = require('path');
const { app } = require('electron');

async function run() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  process.chdir(repoRoot);
  app.setAppPath(repoRoot);
  const { main } = require('./test_916_flow.js');
  await main();
}

app.whenReady()
  .then(async () => {
    try {
      await run();
      app.exit(0);
    } catch (error) {
      console.error('QA 9:16 electron runner failed:', error);
      app.exit(1);
    }
  })
  .catch((error) => {
    console.error('Electron app ready failed:', error);
    app.exit(1);
  });

