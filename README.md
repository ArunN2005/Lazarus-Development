<div align="center">

```
██╗      █████╗ ███████╗ █████╗ ██████╗ ██╗   ██╗███████╗
██║     ██╔══██╗╚══███╔╝██╔══██╗██╔══██╗██║   ██║██╔════╝
██║     ███████║  ███╔╝ ███████║██████╔╝██║   ██║███████╗
██║     ██╔══██║ ███╔╝  ██╔══██║██╔══██╗██║   ██║╚════██║
███████╗██║  ██║███████╗██║  ██║██║  ██║╚██████╔╝███████║
╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝
```

### 🔁 AI-Powered Legacy Codebase Resurrection Engine

[![AWS](https://img.shields.io/badge/Powered%20by-AWS-FF9900?style=for-the-badge&logo=amazonaws&logoColor=white)](https://aws.amazon.com)
[![Amazon Bedrock](https://img.shields.io/badge/Amazon-Bedrock-232F3E?style=for-the-badge&logo=amazonaws&logoColor=white)](https://aws.amazon.com/bedrock)
[![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

**Built for the AWS AI for Bharat Hackathon 2025**  
*Team: LAZARUS | Team Lead: Kiran Kishore V | Track: AI for Learning & Developer Productivity*

[Live Demo](#) · [Architecture](#architecture) · [Features](#features) · [Getting Started](#getting-started)

</div>

---

## 🪦 The Problem

> *200M+ GitHub repos exist. Most can't run. Nobody learns from dead code.*

The #1 way developers learn is by reading **real codebases** — not tutorials. But millions of valuable GitHub projects are trapped in dead, outdated code that won't even install anymore.

- A student finds a perfect full-stack project → runs `npm install` → hits 47 errors → **gives up**
- That portfolio project from 2 years ago? **Rotting.** Dependencies outdated, frameworks 3 versions behind, security vulnerabilities everywhere.
- Your own past work becomes legacy code that embarrasses you instead of showcasing your skills.

**The knowledge inside those codebases dies with them.**

---

## ⚡ What is Lazarus?

**Lazarus** is an AI-powered platform that **resurrects any dead or legacy codebase** — turning it into a modern, runnable, explorable application that developers can learn from, experiment with, and keep alive.

Paste any GitHub link — someone else's or your own old repo. Get back:

| What You Get | Description |
|---|---|
| 🚀 **Live URL** | Modernized, working code deployed and accessible instantly |
| 📊 **Side-by-side Diffs** | Old vs new patterns — learn *why* things changed |
| 🤖 **AI Code Editor** | Ask questions about any file, get contextual explanations |
| 🎨 **Visual AI Design Mode** | Click any element, describe changes in English, watch code update live |
| 🔄 **One-Click PR** | Push modernized code back to your original GitHub repo |

> *It's an AI tutor + code resurrection engine + developer productivity tool in one.*

---

## ✨ Features

### 🔬 Resurrection Pipeline
- **One-link resurrection** — paste any GitHub URL, zero config needed
- **Automatic tech stack & dependency detection** via AST parsing
- **AI migration plan with reasoning** for every single change
- **Parallel code generation** to modern frameworks (batched in 4 phases)
- **Auto build, containerize, and deploy** with a live HTTPS URL
- **Self-healing engine** — AI reads errors, patches, and re-deploys automatically (up to 5×)

### 📚 Learning Tools
- **Side-by-side diff view** — old vs new code for every file showing *why* patterns changed
- **AI contextual Q&A** — highlight any code, ask questions, get answers with full project context
- **Migration plan as teaching doc** — every architectural decision explained

### 💻 AI Code Editor
- **In-browser Monaco Editor** (the VS Code engine) with full file tree navigation
- **AI-assisted editing** with context-aware suggestions and explanations
- **Inline diff accept/reject** for every file — developer stays in control

### 🎨 Visual AI Design Mode
- **Click any element** in the live preview to select it
- **Describe changes in plain English** — AI rewrites the code instantly
- **Live before/after preview** — see visual and code changes side-by-side
- **AI image generation** via Canva integration for asset updates

### 🔒 Security & Monitoring
- Secure authentication via Amazon Cognito
- Real-time pipeline status via WebSocket (API Gateway)
- Full build/deploy logs and request tracing (CloudWatch + X-Ray)
- **Cost: ~$0.70–$2.50 per full resurrection**

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        LAZARUS DASHBOARD                         │
│              Amplify + CloudFront + Cognito + WAF               │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   1. Inspector Agent │  ← AST Parsing, Dep Mapping
                    │     AWS Lambda       │    API Route Extraction
                    └──────────┬──────────┘
                               │ Analysis Data → S3
                    ┌──────────▼──────────┐
                    │  2. Architect Agent  │  ← Claude Sonnet 4.6
                    │     AWS Lambda       │    Migration Plan + Reasoning
                    └──────────┬──────────┘
                               │ Migration Plan → DynamoDB
                    ┌──────────▼──────────┐
                    │   3. Builder Agent   │  ← Claude Opus 4.6
                    │  Parallel Batches:   │    Code Generation (4 Batches)
                    │  Batch 1: Foundation │    Config + DB + ENV
                    │  Batch 2: Core Logic │    API + Auth + Services
                    │  Batch 3: UI Layer   │    Components + Pages
                    │  Batch 4: Surface    │    Styles + Tests + Docs
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  4. Deployer Agent   │  ← CodeBuild → ECR → Fargate
                    │                      │    → App Runner (Live HTTPS URL)
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  5. Validator Agent  │  ← CloudWatch + X-Ray
                    │                      │    Health Check + Log Scanning
                    └──────────┬──────────┘
                         Works?│
                    ✅ YES ────► OUTPUT (Live App + Diff View + AI Editor)
                    ❌ NO  ────► Self-Healing → Patch → Retry (up to 5×)
```

### MCP Servers Used
| MCP Server | Purpose |
|---|---|
| **GitHub MCP** | Repo access and cloning |
| **NPM/PyPI MCP** | Registry lookups for dependency analysis |
| **Web Search MCP** | Fetching migration guides and documentation |
| **Docker MCP** | Container builds |
| **CloudWatch MCP** | Log analysis for self-healing |

---

## 🛠️ Tech Stack

### AI Layer
| Service | Usage |
|---|---|
| **Amazon Bedrock — Claude Opus 4.6** | Code generation, self-healing, patch generation |
| **Amazon Bedrock — Claude Sonnet 4.6** | Migration planning, code Q&A, Visual AI Design |
| **Amazon Bedrock — Claude Haiku** | Tech stack detection, lightweight classification |
| **Canva Image Gen** | AI image generation in Visual AI Design mode |

### Backend (AWS)
| Service | Usage |
|---|---|
| AWS Lambda | API handlers, pipeline phase execution, validation |
| Amazon API Gateway | REST and WebSocket APIs |
| Amazon S3 | Repo file storage, generated code, build assets |
| Amazon DynamoDB | Project state, migration plans, user data |
| Amazon ElastiCache | Context caching for cost-efficient AI calls |
| AWS CodeBuild | Building Docker images for resurrected apps |
| Amazon ECR | Docker image registry |
| AWS App Runner | Deploying resurrected apps with live HTTPS URLs |
| ECS Fargate | Running MCP servers and long-running tasks |
| AWS Secrets Manager | Secure API keys and env variable handling |
| Amazon CloudWatch | Logging and monitoring |
| AWS X-Ray | Request tracing |
| Amazon SNS | Failure notifications and alerts |
| AWS WAF | Web application firewall |

### Frontend
| Tech | Usage |
|---|---|
| **Next.js** | React framework for the platform UI |
| **Monaco Editor** | In-browser code editor (VS Code engine) |
| **AWS Amplify** | Frontend hosting and deployment |
| **Amazon CloudFront** | CDN for fast global delivery |
| **Amazon Cognito** | User authentication and session management |
| **WebSocket API** | Real-time pipeline status updates |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- AWS CLI configured with appropriate IAM permissions
- GitHub OAuth App credentials

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/lazarus.git
cd lazarus

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env.local
```

### Environment Variables

```env
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

# Amazon Bedrock Model IDs
BEDROCK_ARCHITECT_MODEL=us.anthropic.claude-sonnet-4-6
BEDROCK_BUILDER_MODEL=global.anthropic.claude-opus-4-6-v1
BEDROCK_INSPECTOR_MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0

# GitHub OAuth
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# AWS Services
DYNAMODB_TABLE=lazarus-projects
S3_BUCKET=lazarus-repo-storage
APP_RUNNER_REGION=us-east-1

# Amazon Cognito
COGNITO_USER_POOL_ID=your_pool_id
COGNITO_CLIENT_ID=your_client_id
```

### Running Locally

```bash
# Start the development server
npm run dev

# Deploy AWS infrastructure (CDK)
cd infrastructure
npm run cdk deploy
```

---

## 💡 How It Works — The 7-Phase AI Pipeline

```
Phase 1: INSPECT    → Clone repo, AST parse, map all dependencies & API routes
Phase 2: ARCHITECT  → Claude Sonnet 4.6 generates file-by-file migration plan
Phase 3: REVIEW     → Developer reviews, edits, or asks AI to explain any decision
Phase 4: BUILD      → Claude Opus 4.6 generates modernized code in 4 parallel batches
Phase 5: DEPLOY     → CodeBuild → ECR → Fargate → App Runner → Live HTTPS URL
Phase 6: VALIDATE   → Health checks, log scanning, runtime error detection
Phase 7: HEAL       → If broken: AI diagnoses, patches code, re-deploys (up to 5×)
```

After resurrection, developers get access to:
- **Side-by-side diff explorer** — understand every change made
- **In-browser AI code editor** — ask Claude anything about the codebase
- **Visual design mode** — redesign the live app in plain English
- **One-click PR** — push changes back to the original GitHub repo

---

## 💰 Cost Breakdown

Lazarus is fully serverless and pay-as-you-go:

| Service | Cost per Resurrection |
|---|---|
| AI Model Usage (Bedrock) | $0.50 – $2.00 |
| Lambda + Step Functions | $0.05 – $0.10 |
| Build & Deploy (CodeBuild, App Runner, ECR) | $0.10 – $0.30 |
| Storage (S3, DynamoDB, ElastiCache) | ~$0.02 |
| Monitoring & Notifications | < $0.05 |
| **TOTAL PER PROJECT** | **$0.70 – $2.50** |

Compare this to manual migration which can cost **hundreds to thousands of dollars** in developer time.

---

## 📊 How Lazarus Compares

| Tool | What It Does | Lazarus |
|---|---|---|
| Copilot / ChatGPT | File-level code suggestions | Full-repo resurrection + deployment |
| Codemod / OpenRewrite | Rule-based migrations only | AI understands intent + modernizes safely |
| Most AI dev tools | Generate code only | Generates + runs + fixes automatically |
| Traditional modernization | Manual, months, expensive | 5-minute autonomous resurrection |
| Any current system | Static AI | Self-learning AI that improves each run |

---

## 🗺️ Roadmap

- [ ] Support for more languages (Go, Rust, Java Spring)
- [ ] Team collaboration — multiple developers on same resurrection
- [ ] Scheduled re-runs — auto-modernize repos on a cron schedule
- [ ] Marketplace — browse and fork resurrected public repos
- [ ] Self-learning feedback loop — improve migrations from past runs

---

## 🤝 Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

```bash
# Create a feature branch
git checkout -b feature/your-feature-name

# Commit your changes
git commit -m "feat: add your feature"

# Push and open a PR
git push origin feature/your-feature-name
```

---

## 👥 Team

**Team LAZARUS** — AWS AI for Bharat Hackathon 2025

| Name | Role |
|---|---|
| **Kiran Kishore V** | Team Lead & Architect |

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

Built with ❤️ for the **AWS AI for Bharat Hackathon 2025**

*Powered by AWS · Innovation Partner H2S · Media Partner YourStory*

**Dead code deserves a second life. 🔁**

</div>