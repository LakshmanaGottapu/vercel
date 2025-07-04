import path from 'path';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { execSync } from 'child_process';
import { readdirSync, statSync, createReadStream } from 'fs';

dotenv.config();

const {
  GITHUB_REPO_URL,
  AWS_ACCESS_KEY,
  AWS_SECRET_KEY,
  AWS_REGION,
  S3_BUCKET_NAME
} = process.env;

const directoryPath = path.join(process.cwd(), 'output');
const s3path = path.join(directoryPath, 'dist');
async function runProcess() {
  // 1. Clone repository
  // try {
  //   execSync(`git clone ${GITHUB_REPO_URL} ${directoryPath}`, { stdio: 'inherit', shell: true });
  // } catch (error) {
  //   console.error('❌ Git clone failed:', error.stderr?.toString() || error.message);
  //   process.exit(1);
  // }
  // // 2. Install dependencies - using absolute path to yarn
  // try {
  //   execSync(`yarn install`, { cwd: directoryPath, shell: true, stdio: 'inherit' });
  // } catch (error) {
  //   console.error('❌ Git clone failed:', error.stderr?.toString() || error.message);
  //   process.exit(1);
  // }
  // // 3. Build project
  // try {
  //   execSync(`yarn build`, { cwd: directoryPath, shell: true, stdio: 'inherit' });
  // } catch (error) {
  //   console.error('❌ Git clone failed:', error.stderr?.toString() || error.message);
  //   process.exit(1);
  // }
  // 4. Upload to S3
  await uploadToS3(s3path);
}

const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY,
    secretAccessKey: AWS_SECRET_KEY
  }
});

async function uploadToS3(directoryPath) {
  const files = readdirSync(directoryPath);

  for (const file of files) {
    const filePath = path.join(directoryPath, file);
    const stats = statSync(filePath);

    if (stats.isDirectory()) {
      await uploadToS3(filePath);
    } else {
      try {
        const fileStream = createReadStream(filePath);
        const relativePath = path.relative(s3path, filePath);
        const s3Key = relativePath.replace(/\\/g, '/'); // Ensure S3 key is in the correct format
        await s3Client.send(new PutObjectCommand({
          Bucket: S3_BUCKET_NAME,
          Key: s3Key,
          Body: fileStream,
          ContentType: getContentType(filePath),
          CacheControl: path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
        }));
        console.log(`Uploaded ${relativePath} to S3`);
      } catch (err) {
        console.error(`Error uploading ${file}:`, err);
        process.exit(1);
      }
    }
  }
}
const getContentType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  };
  return types[ext] || 'application/octet-stream';
};

runProcess();