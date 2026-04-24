import { OpenAI } from 'openai';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const openai = new OpenAI();
const s3 = new S3Client({ region: "us-east-1" });

export async function processBatchData(userImages) {
    console.log("Starting batch processing...");

    // 🔴 MAJOR CRITICALITY TRIGGER: Cloud API calls inside a Loop
    for (let i = 0; i < userImages.length; i++) {
        
        // 1. OpenAI GPT-4 Vision processing
        const completion = await openai.chat.completions.create({
            model: "gpt-4-vision-preview",
            messages: [
                { role: "user", content: "Analyze this image for anomalies." }
            ]
        });

        // 2. AWS S3 Storage Upload per user
        await s3.send(new PutObjectCommand({
            Bucket: "secure-user-data-bucket",
            Key: `processed-data-${i}.json`,
            Body: JSON.stringify(completion.choices[0])
        }));
    }
}
