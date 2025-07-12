import express from "express";
import fs from "fs"; 
import path from "path";
import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
import { generateSlug } from "random-word-slugs";
import Redis from "ioredis";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT ?? 8000;
const { AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, ECS_CLUSTER_NAME, ECS_TASK_DEFINITION, ECS_SUBNETS, ECS_VPC_ID, ECS_SECURITY_GROUPS, ECS_CONTAINER_NAME, S3_BUCKET_NAME, REDIS_HOST, REDIS_PORT } = process.env;
const app = express();
const dirPath = path.join(process.cwd(), 'logs');
if(!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
}
const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    retryStrategy: (times) => {
        const delay = Math.min(times * 1000, 30000); // Exponential backoff with max delay of 30 seconds
        console.log(`Retrying Redis connection in ${delay}ms...`);
        return delay;
    }
});
redis.on('error', (err) => {
    console.error('Redis error:', err);
});
redis.on('connect', () => {
    console.log('Connected to Redis');
    // You can add any initialization logic here if needed
});
redis.on('ready', () => {
    console.log('Redis is ready');
});
redis.on('end', () => {
    console.log('Redis connection closed');
    process.exit(0);
});
redis.on('reconnecting', () => {
    console.log('Redis is reconnecting...');
});
redis.on('message', (channel, message) => {
    // This will log messages received on the subscribed channel
    // Handle the message as needed
    const folderPath = path.join(dirPath, new Date().toISOString().split('T')[0]);
    if (!fs.existsSync(folderPath)) 
        fs.mkdirSync(folderPath);
    const filePath = path.join(folderPath,  `${channel}.log`);
    fs.appendFile(filePath, `-> ${message}\n`, (err) => {
        if (err) console.error('Error writing to log file:', err);
        else console.log(`Logged message to ${filePath}`);
    });
});
app.use(express.json());
if (!AWS_REGION) {
    console.error("AWS_REGION environment variable is not set.");
    process.exit(1);
}
if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    console.error("AWS credentials are not set. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.");
    process.exit(1);
}
if (!ECS_CLUSTER_NAME || !ECS_SUBNETS || !ECS_SECURITY_GROUPS) {
    console.error("ECS configuration environment variables are not set. Please set ECS_CLUSTER_NAME, ECS_SUBNETS, and ECS_SECURITY_GROUPS environment variables.");
    res.status(500).json({ error: "ECS configuration is not set." });
}
if (!ECS_TASK_DEFINITION) {
    console.error("ECS_TASK_DEFINITION environment variable is not set.");
    res.status(500).json({ error: "ECS task definition is not set." });
}
if (!ECS_CONTAINER_NAME) {
    console.error("ECS_CONTAINER_NAME environment variable is not set.");
    res.status(500).json({ error: "ECS container name is not set." });
}
const config = {
    region: AWS_REGION,
    credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY
    }
};
const ecsClient = new ECSClient(config);
app.post("/project", async (req, res) => {
    const { gitURL } = req.body;
    if (!gitURL) {
        console.error("gitURL is not provided in the request body.");
        res.status(400).json({ error: "gitURL is required." });
    }
    const projectId = generateSlug();
    const command = new RunTaskCommand({
        cluster: ECS_CLUSTER_NAME, // Replace with your ECS cluster name  
        taskDefinition: ECS_TASK_DEFINITION, // Replace with your ECS task definition});
        launchType: "FARGATE",
        networkConfiguration: {
            awsvpcConfiguration: {
                vpcId: ECS_VPC_ID, // Replace with your VPC ID
                subnets: ECS_SUBNETS.split(","), // Replace with your subnet IDs
                securityGroups: ECS_SECURITY_GROUPS.split(","), // Replace with your security group IDs
                assignPublicIp: "ENABLED" // or "DISABLED" based on your requirements
            }
        },
        overrides: {
            containerOverrides: [
                {
                    name: ECS_CONTAINER_NAME, // Replace with your container name
                    environment: [
                        { name: "GITHUB_REPO_URL", value: gitURL },
                        { name: "PROJECT_ID", value: projectId },
                        { name: "AWS_ACCESS_KEY", value: AWS_ACCESS_KEY_ID },
                        { name: "AWS_SECRET_KEY", value: AWS_SECRET_ACCESS_KEY },
                        { name: "AWS_REGION", value: AWS_REGION },
                        { name: "S3_BUCKET_NAME", value: S3_BUCKET_NAME },
                        { name: "REDIS_HOST", value: REDIS_HOST },
                        { name: "REDIS_PORT", value: REDIS_PORT }
                    ]
                }
            ]
        }
    });
    console.log("Running ECS task");
    // Send the command to ECS
    try {
        const response = await ecsClient.send(command);
        // console.log(response);
        redis.subscribe(projectId, (err, count) => {
            if (err) {
                console.error('Failed to subscribe to Redis channel:', err);
            } else {
                console.log(`Subscribed to Redis channel ${projectId}. Current subscription count: ${JSON.stringify(count)}`);
            }
        });
        res.json({ message: "ECS task is being run", hostUrl: `http://${projectId}.localhost:3000` });
    } catch (error) {
        console.error("Error running ECS task:", error);
        res.status(500).json({ error: "Failed to run ECS task." });
    }
})

app.listen(PORT, () => console.log(`listening to http://localhost:${PORT}`))