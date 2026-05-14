import 'dotenv/config';
import { spawn } from 'child_process';
import { prepareRemotionProject } from './remotion-data.js';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

const projectId = process.argv[2];

if (!projectId) {
  console.error('Usage: node scripts/render-remotion.js <projectId>');
  process.exit(1);
}

try {
  const { propsPath, outputPath } = await prepareRemotionProject(projectId);

  await run('npx', [
    'remotion',
    'render',
    'remotion/index.jsx',
    'StoryVideo',
    outputPath,
    `--props=${propsPath}`,
    '--overwrite',
    '--codec=h264',
    '--pixel-format=yuv420p',
  ]);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
