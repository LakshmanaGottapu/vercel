import express from "express";
import fs from "fs"; 
import path from "path";
import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
import { generateSlug } from "random-word-slugs";
import Redis from "ioredis";
import dotenv from "dotenv";
import { PrismaClient } from '@prisma/client'


const prisma = new PrismaClient();
dotenv.config();

const PORT = process.env.PORT ?? 8000;
const { AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, ECS_CLUSTER_NAME, ECS_TASK_DEFINITION, ECS_SUBNETS, ECS_VPC_ID, ECS_SECURITY_GROUPS, ECS_CONTAINER_NAME, S3_BUCKET_NAME, REDIS_HOST, REDIS_PORT } = process.env;
const app = express();
const dirPath = path.join(process.cwd(), 'logs');
const redisHost = REDIS_HOST || 'localhost';
const redisPort = REDIS_PORT || 6379;
if(!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
}
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
redis.subscribe('Deployment', (err, count) => {
    if (err) {
        console.error('Failed to subscribe to Redis channel:', err);
    } else {
        console.log(`Subscribed to Redis channel 'Deployment'. Current subscription count: ${JSON.stringify(count)}`);
    }
});
redis.on('message', async (channel, message) => {
    if(channel == 'Deployment') {
        const data = JSON.parse(message);
        if (data.type === 'DEPLOYMENT_STATUS') {
            // Update deployment status in database
            await prisma.deployment.updateMany({
                where: {
                    project: { slug: data.projectId },
                    status: 'PENDING' // Update only if not already completed
                },
                data: {
                    status: data.status,
                    completedAt: new Date()
                }
            });
            console.log(`Updated deployment status for ${channel}: ${data.status}`);
        }
        return ;
    } 
    // This will log messages received on the subscribed channel
    // Handle the message as needed
    const folderPath = path.join(dirPath, channel);
    if (!fs.existsSync(folderPath)) 
        fs.mkdirSync(folderPath);
    const filePath = path.join(folderPath,  `${new Date().toISOString().split('T')[0]}.log`);
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
app.post("/project/create", async (req, res) => {
    const { slug, gitURL } = req.body;
    const projectName = slug ?? generateSlug();
    if (!gitURL) {
        console.error("gitURL is not provided in the request body.");
        return res.status(400).json({ error: "gitURL is required." });
    }
    if (!/^(https?|git):\/\/[^\s/$.?#].[^\s]*$/.test(gitURL)) {
        console.error("Invalid gitURL format:", gitURL);
        return res.status(400).json({ error: "Invalid gitURL format." });
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectName)) {
        console.error("Invalid project name format:", projectName);
        return res.status(400).json({ error: "Project name can only contain lowercase letters, numbers, and hyphens." });
    }
    const existingProject = await prisma.project.findUnique({
        where: { slug: projectName }
    });
    if (existingProject) {
        console.error(`Project with slug ${projectName} already exists.`);
        return res.status(400).json({ error: "Project with this name already exists." });
    }
    console.log("Creating project with name:", projectName, "and gitURL:", gitURL);
    // Create the project in the database
    try {
        const project = await prisma.project.create({
            data: {
                slug:projectName,
                gitURL
            }
        });
        console.log("Project created:", project);
        res.status(201).json(project);
    } catch (error) {
        console.error("Error creating project:", error);
        res.status(500).json({ error: "Failed to create project." });
    }
});
app.post("/deploy", async (req, res) => {
    const { slug } = req.body;
    if( !slug) {
        console.error("slug is not provided in the request body.");
        return res.status(400).json({ error: "slug is required." });
    }
    const project = await prisma.project.findUnique({
        where: { slug }
    });
    if (!project) {
        console.error(`Project with slug ${slug} not found.`);
        return res.status(404).json({ error: "Project not found." });
    }
    const projectId = project.slug;
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
                        { name: "GITHUB_REPO_URL", value: project.gitURL },
                        { name: "PROJECT_ID", value: project.slug },
                        { name: "AWS_ACCESS_KEY", value: AWS_ACCESS_KEY_ID },
                        { name: "AWS_SECRET_KEY", value: AWS_SECRET_ACCESS_KEY },
                        { name: "AWS_REGION", value: AWS_REGION },
                        { name: "S3_BUCKET_NAME", value: S3_BUCKET_NAME },
                        { name: "REDIS_HOST", value: redisHost },
                        { name: "REDIS_PORT", value: redisPort }
                    ]
                }
            ]
        }
    });
    console.log("Running ECS task");
    // Send the command to ECS
    try {
        await ecsClient.send(command);
        await prisma.deployment.create({
            data: {
                project: { connect: { id: project.id } },
                status: "PENDING"
            }
        });
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
app.get("/", (__, res)=>{
    res.send("Hello I am api server")
})
app.listen(PORT, () => console.log(`listening to http://localhost:${PORT}`))