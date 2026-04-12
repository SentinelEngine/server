# ⚡ Code. Cost. Control.

> CloudGauge — Real-time cost intelligence directly inside your code editor.

---

## 📌 Overview

Modern developers write code without visibility into the cloud costs it generates. Costs are only realized after deployment — often leading to unexpected bills.

**This project solves that by shifting cost awareness from billing time → coding time.**

We provide:
- Real-time cost estimation  
- Optimization suggestions  
- PR-level cost impact tracking  
- Tamper-proof cost logs using Web3  

---

## ❗ Problem

- No cost visibility during development  
- Billing feedback delayed by weeks  
- Expensive APIs and cloud usage go unnoticed  
- No accountability for cost-heavy code changes  

---

## 💡 Solution

> “CloudGauge - ESLint for Cloud Costs”

A system that:
- Analyzes your code as you write  
- Estimates cloud cost in real time  
- Suggests optimizations  
- Tracks cost changes across PRs  
- Ensures integrity via cryptographic proofs  

---

## ✨ Features

### 🔹 Real-Time Cost Estimation
- Detects cloud/API usage from code  
- Estimates monthly cost instantly  

### 🔹 Optimization Suggestions
- Suggests cheaper alternatives:
  - GPT-4 → GPT-3.5  
  - Add caching  
  - Batch requests  

### 🔹 PR Cost Diff
- Compares cost before vs after changes  
- Prevents expensive code merges  

### 🔹 Tamper-Proof Cost Logs (Web3)
- Generates SHA-256 hash of cost reports  
- Stores hash on blockchain (Sepolia)  
- Ensures reports cannot be modified  

### 🔹 Developer-First Experience
- Integrated into VS Code  
- Inline feedback + suggestions  
- ESLint-like workflow  

---

## 🏗️ Architecture

```
VS Code Extension
        ↓
Backend (TypeScript)
        ↓
AST Analysis Engine
        ↓
Cost Estimation Engine
        ↓
Database (Prisma)
        ↓
Hash Generation (SHA-256)
        ↓
Blockchain (Sepolia)
```

---

## ⚙️ Tech Stack

### 🔹 Frontend
- VS Code Extension API  

### 🔹 Backend
- TypeScript  
- Node.js  
- AST Parsing (Babel / TypeScript Compiler API)  

### 🔹 Database
- Prisma ORM  
- PostgreSQL / MongoDB  

### 🔹 Web3 Layer
- Solidity (Smart Contract)  
- Ethers.js  
- Sepolia Testnet  

---

## 🔍 How It Works

### 1. Code Analysis
- Parses code using AST  
- Detects usage of:
  - LLM APIs  
  - Cloud services  
  - External APIs  

### 2. Cost Estimation
- Maps usage → pricing models  
- Calculates monthly cost projection  

### 3. Optimization Engine
- Identifies expensive patterns  
- Suggests cost-saving alternatives  

### 4. PR Cost Diff
- Compares:
  - Base branch cost  
  - New branch cost  
- Outputs cost difference  

### 5. Tamper-Proof Logging
- Converts report → JSON  
- Generates SHA-256 hash  
- Stores:
  - Full report → DB  
  - Hash → Blockchain  

---

## 🔐 Web3 Integration

We use Web3 **only for verification**, not computation.

### Flow

```
Cost Report → Hash → Store on Sepolia
```

### Benefits
- Immutable records  
- Verifiable cost history  
- Audit-ready system  

---

## 🧪 Demo Flow

1. Open code in VS Code  
2. Detect API usage  
3. Show cost estimate  
4. Display optimization suggestions  
5. Show PR cost difference  
6. Modify report → verification fails (tampering detected)  

---

## 🛠️ Setup

### 🔹 Backend

```bash
npm install
npm run dev
```

### 🔹 Environment Variables

```env
DATABASE_URL=...
RPC_URL=...
PRIVATE_KEY=...
CONTRACT_ADDRESS=...
```

### 🔹 VS Code Extension

```bash
npm install
npm run compile
# Press F5 to run extension
```

### 🔹 Smart Contract

- Deploy contract on Sepolia  
- Store contract address in `.env`  

---

## 📊 Example

```js
// Before
use GPT-4 → $200/month

// After optimization
use GPT-3.5 → $40/month

// Add caching
→ $15/month
```

---

## 🚀 Future Scope

- CI/CD integration (PR gating)  
- Multi-cloud support (AWS, GCP, Azure)  
- Advanced AI-based optimization  
- Cost heatmaps in editor  
- Enterprise dashboards  
- On-chain audit dashboards  

---

## 🤝 Contribution

Contributions are welcome!

- Fork the repository  
- Create a feature branch  
- Submit a pull request  

---

## 🧠 Key Insight

> “We don’t just show developers that their code is expensive — we tell them how to make it cheaper, instantly.”

---

## 📜 License

MIT License
