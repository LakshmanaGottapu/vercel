import express from "express";
import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
import { generateSlug } from "random-word-slugs";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT ?? 8000;
const { AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, ECS_CLUSTER_NAME, ECS_TASK_DEFINITION, ECS_SUBNETS, ECS_VPC_ID, ECS_SECURITY_GROUPS, ECS_CONTAINER_NAME, S3_BUCKET_NAME } = process.env;
const app = express();
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
                        { name:"AWS_ACCESS_KEY", value: AWS_ACCESS_KEY_ID },
                        { name:"AWS_SECRET_KEY", value: AWS_SECRET_ACCESS_KEY },
                        { name:"AWS_REGION", value: AWS_REGION },
                        { name:"S3_BUCKET_NAME", value: S3_BUCKET_NAME }
                    ]
                }
            ]
        }
    });
    console.log("Running ECS task with command:", command);
    // Send the command to ECS
    try{
        const response = await ecsClient.send(command);
        console.log(response);
        res.json({ message: "ECS task is being run", hostUrl: `http://${projectId}.localhost:3000` });
    }catch(error){
       console.error("Error running ECS task:", error);
        res.status(500).json({ error: "Failed to run ECS task." });
    }
})

app.listen(PORT, () => console.log(`listening to http://localhost:${PORT}`))