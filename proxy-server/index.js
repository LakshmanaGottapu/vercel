import http from 'http';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { lookup } from 'mime-types';
import dotenv from 'dotenv';
dotenv.config();
const { PORT = 3000, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME } = process.env;
const s3Client = new S3Client({
  region: AWS_REGION,
    credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY
    }
});

http.createServer(async (req, res) => {
    const host = req.headers.host || '';
    const subdomain = host.split('.')[0]; // Extract subdomain from the host header
    const requestedPath = req.url === '/' ? 'index.html' : req.url.slice(1); // Default to index.html if no specific path is requested
    const contentType = lookup(requestedPath) || 'application/octet-stream'; // Get the content type based on the file extension
    const key = `__outputs/${subdomain}/${requestedPath}`; // Construct the S3 key based on the subdomain and requested path
    const command = new GetObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: key // Use the correct S3 object key
    });
    try{
        const data = await s3Client.send(command);
        res.writeHead(200, {'Content-Type': contentType, 'Cache-Control': contentType==='text/html' ? 'no-cache' : 'public, max-age=31536000, immutable'});
        data.Body.pipe(res);
    }catch(error){
        if(req.url === '/'){
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end("Failed to fetch from AWS S3: " + error.message);
        }
        else{
            const fallbackKey = `__outputs/${subdomain}/index.html`; // Fallback to index.html if the requested path is not found
            const fallbackcommand = new GetObjectCommand({
                Bucket: S3_BUCKET_NAME,
                Key: fallbackKey // Use the correct S3 object key
            });
            const fallbackdata = await s3Client.send(fallbackcommand);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            fallbackdata.Body.pipe(res);
        }
    }
}).listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});

