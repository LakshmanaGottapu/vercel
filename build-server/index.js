import path from 'path';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { execSync } from 'child_process';
import { readdirSync, statSync, createReadStream } from 'fs';
import { contentType } from 'mime-types';

dotenv.config();
const { AWS_ACCESS_KEY, AWS_SECRET_KEY, AWS_REGION, S3_BUCKET_NAME, PROJECT_ID } = process.env;

const directoryPath = path.join(process.cwd(), 'output');
const s3path = path.join(directoryPath, 'dist');

async function runProcess() {
  // 1. Install dependencies - using absolute path to yarn
  try {
    execSync(`npm install`, { cwd: directoryPath, shell: true, stdio: 'inherit' });
  } catch (error) {
    console.error('npm install:', error.stderr?.toString() || error.message);
    process.exit(1);
  }
  // 2. Build project
  try {
    execSync(`npm run build`, { cwd: directoryPath, shell: true, stdio: 'inherit' });
  } catch (error) {
    console.error('❌ npm build failed:', error.stderr?.toString() || error.message);
    process.exit(1);
  }
  // 3. Upload to S3
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
  const files = readdirSync(directoryPath, {recursive:true});
  for (const file of files) {
    const filePath = path.join(directoryPath, file);
    const stats = statSync(filePath);
    if (stats.isDirectory()) continue;
    else {
      try {
        const fileStream = createReadStream(filePath);
        const relativePath = path.relative(s3path, filePath);
        const s3Key = relativePath.replace(/\\/g, '/'); // Ensure S3 key is in the correct format
        await s3Client.send(new PutObjectCommand({
          Bucket: S3_BUCKET_NAME,
          Key: `__outputs/${PROJECT_ID}/${s3Key}`,
          Body: fileStream,
          ContentType: contentType(path.extname(filePath)) ?? 'application/octet-stream',
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

runProcess();