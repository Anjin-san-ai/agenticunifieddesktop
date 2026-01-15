# Azure Deployment Guide for Athena Cognitive Desktop

This guide walks you through deploying the Athena Cognitive Desktop application to Azure App Service with automated CI/CD via GitHub Actions.

## Prerequisites

- Azure subscription with active billing
- GitHub account
- Azure CLI installed (optional, for command-line deployment)
- Node.js 18+ installed locally (for testing)

## Step 1: Create Azure OpenAI Resource

### 1.1 Create the Resource

1. Go to [Azure Portal](https://portal.azure.com)
2. Click **Create a resource** → Search for **"Azure OpenAI"**
3. Click **Create**
4. Fill in the form:
   - **Subscription**: Select your subscription
   - **Resource Group**: Create new (e.g., `rg-athena-prod`) or use existing
   - **Region**: Choose a region (e.g., `East US`, `West Europe`, `UK South`)
   - **Name**: Enter a unique name (e.g., `athena-openai-{yourname}`)
   - **Pricing tier**: Select **Standard S0**
5. Click **Review + create** → **Create**
6. Wait for deployment to complete (2-3 minutes)

### 1.2 Get Your Endpoint and Key

1. Go to your Azure OpenAI resource
2. Navigate to **Keys and Endpoint** in the left menu
3. Copy the following:
   - **Endpoint**: `https://your-resource.openai.azure.com/`
   - **Key 1**: Copy and save securely (you'll need this later)

### 1.3 Deploy a Model

1. Click **Go to Azure OpenAI Studio** (button in the overview page)
2. In Azure OpenAI Studio, click **Deployments** in the left menu
3. Click **+ Create** → **Create new deployment**
4. Configure:
   - **Model**: Select `gpt-4` or `gpt-4o` (you mentioned gpt-40, likely meant gpt-4o)
   - **Deployment name**: Enter `gpt-4` (or your preferred name - remember this!)
   - **Advanced options**: Leave defaults
5. Click **Create**
6. Wait for deployment (1-2 minutes)

**Important**: Note down your:
- Endpoint URL
- API Key
- Deployment name

## Step 2: Create Azure App Service

### 2.1 Create the App Service

1. In Azure Portal, click **Create a resource** → Search for **"Web App"**
2. Click **Create**
3. Fill in the **Basics** tab:
   - **Subscription**: Your subscription
   - **Resource Group**: Same as OpenAI resource (e.g., `rg-athena-prod`)
   - **Name**: `athena-desktop` (or your choice - must be globally unique)
     - This becomes: `https://athena-desktop.azurewebsites.net`
   - **Publish**: **Code**
   - **Runtime stack**: **Node 18 LTS** (or Node 20 LTS)
   - **Operating System**: **Linux** (recommended)
   - **Region**: Same as OpenAI resource (for lower latency)
   - **App Service Plan**: Click **Create new**
     - **Name**: `asp-athena-prod`
     - **Operating System**: **Linux**
     - **Region**: Same as above
     - **Pricing tier**: **Basic B1** ($13/month) or higher for production
     - Click **OK**
4. Click **Review + create** → **Create**
5. Wait for deployment (2-3 minutes)

### 2.2 Configure Application Settings

1. Go to your App Service resource
2. Navigate to **Configuration** → **Application settings**
3. Click **+ New application setting** for each of the following:

   | Name | Value | Description |
   |------|-------|-------------|
   | `AZURE_OPENAI_ENDPOINT` | `https://your-resource.openai.azure.com/` | From Step 1.2 |
   | `AZURE_OPENAI_API_KEY` | `your-key-here` | From Step 1.2 (Key 1) |
   | `AZURE_OPENAI_DEPLOYMENT_NAME` | `gpt-4` | From Step 1.3 |
   | `AZURE_OPENAI_API_VERSION` | `2024-10-01-preview` | API version |
   | `NODE_ENV` | `production` | Environment |
   | `SUPPRESS_AUTO_BOT_REPLY` | `false` | Optional: set to `true` to suppress auto bot replies |
   | `PORT` | (leave empty) | Azure sets this automatically |

4. Click **Save** at the top
5. Azure will restart your app automatically

### 2.3 Get Publish Profile

1. In your App Service, click **Get publish profile** button (top toolbar)
2. The `.PublishSettings` file will download
3. Open the file in a text editor
4. Copy the **entire contents** of the file (you'll need this for GitHub Secrets)

## Step 3: Set Up GitHub Repository

### 3.1 Create GitHub Repository

1. Go to [GitHub](https://github.com) and sign in
2. Click **+** → **New repository**
3. Fill in:
   - **Repository name**: `athena-desktop` (or your choice)
   - **Description**: "Athena Cognitive Desktop - Contact Center AI Application"
   - **Visibility**: Public or Private (your choice)
   - **DO NOT** initialize with README, .gitignore, or license (we already have these)
4. Click **Create repository**

### 3.2 Push Code to GitHub

**If you haven't initialized git yet:**

```bash
cd "/Users/imrankhan/Projects/Indranilapp/CC_Agentic/Agentic Unified Desktop"
git init
git add .
git commit -m "Initial commit: Athena Cognitive Desktop with Azure deployment config"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

**If git is already initialized:**

```bash
cd "/Users/imrankhan/Projects/Indranilapp/CC_Agentic/Agentic Unified Desktop"
git add .
git commit -m "Add Azure deployment configuration"
git push origin main
```

Replace `YOUR_USERNAME` and `YOUR_REPO_NAME` with your actual GitHub username and repository name.

### 3.3 Configure GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add secret:
   - **Name**: `AZURE_WEBAPP_PUBLISH_PROFILE`
   - **Value**: Paste the **entire contents** of the `.PublishSettings` file from Step 2.3
5. Click **Add secret**

### 3.4 Update GitHub Actions Workflow

1. In your repository, go to `.github/workflows/azure-deploy.yml`
2. Update the `AZURE_WEBAPP_NAME` environment variable to match your App Service name:
   ```yaml
   env:
     AZURE_WEBAPP_NAME: athena-desktop    # Change this to your App Service name
   ```
3. Commit and push:
   ```bash
   git add .github/workflows/azure-deploy.yml
   git commit -m "Update Azure App Service name in workflow"
   git push origin main
   ```

## Step 4: Verify Deployment

### 4.1 Check GitHub Actions

1. Go to your GitHub repository
2. Click **Actions** tab
3. You should see a workflow run triggered by your push
4. Click on the workflow run to see progress
5. Wait for it to complete (2-5 minutes)

### 4.2 Test Your Application

1. Once deployment succeeds, visit: `https://YOUR_APP_NAME.azurewebsites.net`
2. You should see the Athena Desktop UI
3. Test with a customer ID: `https://YOUR_APP_NAME.azurewebsites.net?cust=random`
4. Try sending a message to verify Azure OpenAI integration

### 4.3 Check Logs

If something doesn't work:

1. Go to Azure Portal → Your App Service
2. Navigate to **Log stream** (under Monitoring)
3. Check for errors
4. Also check **App Service logs** → **Log stream** for more details

## Step 5: Optional - Local Development Setup

Create a `.env` file in your project root (never commit this):

```bash
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your-key-here
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4
AZURE_OPENAI_API_VERSION=2024-10-01-preview
PORT=3001
NODE_ENV=development
```

Then run locally:
```bash
npm install
npm start
```

## Troubleshooting

### Deployment Fails in GitHub Actions

- **Check**: App Service name in workflow matches Azure
- **Check**: Publish profile secret is correctly set
- **Check**: App Service exists and is running
- **Solution**: Re-download publish profile and update secret

### Application Doesn't Start

- **Check**: Application settings in Azure (all required env vars set)
- **Check**: Log stream in Azure Portal for errors
- **Check**: Node.js version matches (18.x)
- **Solution**: Verify all environment variables are set correctly

### Azure OpenAI Calls Fail

- **Check**: Endpoint URL is correct (includes trailing slash)
- **Check**: API key is valid
- **Check**: Deployment name matches exactly
- **Check**: Model is deployed in Azure OpenAI Studio
- **Solution**: Re-verify all credentials in Azure Portal

### 404 Errors on Routes

- **Check**: `startup.sh` is executable (should be handled by Azure)
- **Check**: `package.json` has correct start script
- **Solution**: Verify static file serving is working

### CORS Issues

- **Check**: CORS is enabled in `src/server.js` (it is by default)
- **Solution**: If embedding in another domain, update CORS settings

## Cost Management

### Estimated Monthly Costs

- **Azure App Service B1**: ~$13/month
- **Azure OpenAI GPT-4**: Pay-per-use
  - Input: ~$0.03 per 1K tokens
  - Output: ~$0.06 per 1K tokens
  - Typical usage: $50-200/month depending on volume
- **Total**: ~$65-215/month for small-to-medium usage

### Cost Optimization Tips

1. Use **F1** (Free) tier for testing (limited to 60 minutes/day)
2. Set up **budget alerts** in Azure
3. Monitor usage in Azure OpenAI Studio
4. Consider using **gpt-3.5-turbo** for non-critical features (cheaper)

## Next Steps

- Set up **Application Insights** for monitoring
- Configure **custom domain** if needed
- Set up **staging slot** for blue-green deployments
- Add **authentication** if required
- Configure **backup** strategy

## Support

For issues:
1. Check Azure App Service logs
2. Check GitHub Actions logs
3. Review this deployment guide
4. Check Azure OpenAI resource status

## Manual Deployment (Alternative)

If you prefer manual deployment instead of GitHub Actions:

```bash
# Install Azure CLI
az login

# Deploy using ZIP
az webapp deployment source config-zip \
  --resource-group rg-athena-prod \
  --name athena-desktop \
  --src deploy.zip
```

Or use VS Code Azure extension for drag-and-drop deployment.
