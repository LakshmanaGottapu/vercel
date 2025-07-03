import path from 'path';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { exec } from 'child_process';
import { readdirSync, statSync, createReadStream } from 'fs';
import { promisify } from 'util';

dotenv.config();
const execPromise = promisify(exec); // Convert exec to promise-based

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
  try {
    // 1. Clone repository
    await execPromise(`git clone ${GITHUB_REPO_URL} ${directoryPath}`);
    console.log('Repository cloned successfully');

    // 2. Install dependencies - using absolute path to yarn
    await execPromise(`yarn install`, { cwd: directoryPath, shell:true });
    console.log('Dependencies installed successfully');

    // 3. Build project
    await execPromise(`yarn build`, { cwd: directoryPath, shell:true });
    console.log('Project built successfully');

    // 4. Upload to S3
    await uploadToS3(s3path);
  } catch (error) {
    console.error('Process failed:', error);
    process.exit(1);
  }
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