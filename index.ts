const cached = await redis.get(key)
const res = await openai.chat.completions.create({ model: "gpt-4o" })
