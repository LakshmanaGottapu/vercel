import path from 'path';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { execSync } from 'child_process';
import { readdirSync, statSync, createReadStream } from 'fs';
import { contentType } from 'mime-types';
import Redis from 'ioredis';  
dotenv.config();
const { AWS_ACCESS_KEY, AWS_SECRET_KEY, AWS_REGION, S3_BUCKET_NAME, PROJECT_ID } = process.env;

const directoryPath = path.join(process.cwd(), 'output');
const s3path = path.join(directoryPath, 'dist');
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || 6379;
const redis = new Redis({
  host: redisHost,
  port: redisPort,
  retryStrategy: (times) => {
    const delay = Math.min(times * 1000, 30000); // Exponential backoff with max delay of 30 seconds
    console.log(`Retrying Redis connection in ${delay}ms...`);
    return delay;
  }
});
redis.on('error', (err) => {
  console.error('Redis error:', err);
  process.exit(1);
});
redis.on('connect', () => {
  console.log('Connected to Redis');
  runProcess();
});
redis.on('ready', () => {
  console.log('Redis is ready');  
});
redis.on('end', () => {
  console.log('Redis connection closed');
  process.exit(0);
});
function publishLog(message){
  if(typeof message !== 'string') {
    message = JSON.stringify(message);
  }
  redis.publish(PROJECT_ID, message);
  // console.log(`Published message to Redis channel ${PROJECT_ID}:`, message);
}
async function runProcess() {
  publishLog('Build server started');
  // 1. Install dependencies - using absolute path to yarn
  try {
    publishLog('Installing dependencies...');
    execSync(`npm install`, { cwd: directoryPath, shell: true, stdio: 'inherit' });
    publishLog('Dependencies installed successfully');
  } catch (error) {
    console.error('npm install:', error.stderr?.toString() || error.message);
    publishLog('❌ npm install failed');
    process.exit(1);
  }
  // 2. Build project
  try {
    publishLog('Building project...');
    execSync(`npm run build`, { cwd: directoryPath, shell: true, stdio: 'inherit' });
    publishLog('Project built successfully');
  } catch (error) {
    console.error('❌ npm build failed:', error.stderr?.toString() || error.message);
    publishLog('❌ npm build failed');
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
  publishLog(`Uploading files from ${directoryPath} to S3 bucket ${S3_BUCKET_NAME}`);
  if (!S3_BUCKET_NAME) {
    console.error('S3_BUCKET_NAME is not defined in .env file');
    publishLog('❌ S3_BUCKET_NAME is not defined in .env file');
    process.exit(1);
  }
  if (!directoryPath) {
    console.error('Directory path is not defined');
    publishLog('❌ Directory path is not defined');
    process.exit(1);
  }
  if (!directoryPath.startsWith(process.cwd())) {
    console.error('Directory path must be an absolute path');
    publishLog('❌ Directory path must be an absolute path');
    process.exit(1);
  }
  if (!statSync(directoryPath).isDirectory()) {
    console.error('Provided path is not a directory');
    publishLog('❌ Provided path is not a directory');
    process.exit(1);
  }
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
        publishLog(`Uploading ${relativePath} to S3 as ${s3Key}`);
        await s3Client.send(new PutObjectCommand({
          Bucket: S3_BUCKET_NAME,
          Key: `__outputs/${PROJECT_ID}/${s3Key}`,
          Body: fileStream,
          ContentType: contentType(path.extname(filePath)) ?? 'application/octet-stream',
          CacheControl: path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
        }));
        console.log(`Uploaded ${relativePath} to S3`);
        publishLog(`✅ Uploaded ${relativePath} to S3`);
      } catch (err) {
        console.error(`Error uploading ${file}:`, err);
        publishLog(`❌ Error uploading ${file}: ${err.message}`);
        process.exit(1);
      }
    }
  }
  publishLog(`All files uploaded to S3 bucket ${S3_BUCKET_NAME}`);
  console.log(`All files uploaded to S3 bucket ${S3_BUCKET_NAME}`);
  redis.quit();
  process.exit(0);
}

