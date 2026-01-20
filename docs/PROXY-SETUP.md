# Proxy Server Setup Guide

This guide explains how to set up and use a proxy server with the LLM Conversations field plug-in to support multiple AI providers—OpenAI (GPT), Google (Gemini), and Anthropic (Claude)—while bypassing CORS restrictions.

## Table of Contents

- [Why You Need a Proxy](#why-you-need-a-proxy)
- [Supported Providers](#supported-providers)
- [Cloudflare Workers Setup](#cloudflare-workers-setup)
- [API Key Management](#api-key-management)
- [Field Plugin Configuration](#field-plugin-configuration)
- [Provider-Specific Setup](#provider-specific-setup)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)

## Why You Need a Proxy

When using this field plug-in in web browsers (like Web Collect), direct API calls to AI providers are blocked by CORS (Cross-Origin Resource Sharing) policies. A proxy server solves this by:

1. **Bypassing CORS**: The proxy adds the necessary CORS headers
2. **Enabling Google (Gemini) and Anthropic (Claude)**: These providers require a proxy for web use
3. **Centralizing API Keys**: Optionally store keys securely on the proxy
4. **Rate Limiting**: Control usage across your organization

### When to Use Direct vs Proxy

| Provider | Direct Connection | Proxy Required | Notes |
|----------|-------------------|----------------|-------|
| OpenAI (GPT) | ✅ SurveyCTO Collect | ✅ Web Collect | Optional for Collect, required for Web |
| Google (Gemini) | ❌ Never | ✅ Always | Always requires proxy |
| Anthropic (Claude) | ❌ Never | ✅ Always | Always requires proxy |

## Supported Providers

This field plug-in supports three AI providers:

1. **OpenAI (GPT)**: GPT-4, GPT-4o, GPT-3.5
   - Default provider
   - Works with direct connection in Collect
   - Proxy optional but recommended

2. **Google (Gemini)**: Gemini 2.5, Gemini 1.5
   - Requires proxy server
   - Supports streaming

3. **Anthropic (Claude)**: Claude 4.5, Claude 3.5, Claude 3
   - Requires proxy server
   - Supports streaming

## Cloudflare Workers Setup

Cloudflare Workers is the recommended proxy solution - it's free for up to 100,000 requests/day and very easy to set up.

### Step 1: Create a Cloudflare Account

1. Go to [cloudflare.com](https://cloudflare.com)
2. Sign up for a free account
3. Complete email verification

### Step 2: Create a Worker

1. In your Cloudflare dashboard, click **Workers & Pages** in the sidebar
2. Click **Create Application** → **Create Worker**
3. Give it a name (e.g., `surveycto-ai-proxy`)
4. Click **Deploy** (we'll add code next)

### Step 3: Add the Proxy Code

1. After deployment, click **Edit Code**
2. Delete all the default code
3. Copy the entire contents of `deployment/cloudflare-worker.js` from this repository
4. Paste it into the code editor
5. Click **Save and Deploy**

### Step 4: Get Your Worker URL

After deployment, your Worker URL will look like:
```
https://surveycto-ai-proxy.your-username.workers.dev
```

Save this URL - you'll need it for the field plug-in configuration.

### Step 5 (Optional): Add Custom Domain

For production use, you can add a custom domain:

1. In your Worker settings, click **Triggers** → **Custom Domains**
2. Click **Add Custom Domain**
3. Enter your domain (e.g., `api.yourproject.org`)
4. Follow the DNS configuration instructions

## API Key Management

You have two options for managing API keys:

### Option 1: Pass Keys from Form (Default)

**Pros:** Simple setup, different keys per form
**Cons:** Keys visible in form definition

```
custom-llm-conversations(
    provider=openai,
    api-key=sk-your_api_key_here,
    proxy-url=https://your-worker.workers.dev
)
```

### Option 2: Store Keys in Cloudflare (Recommended)

**Pros:** More secure, centralized management
**Cons:** Requires additional setup

#### Setup Steps:

1. In your Cloudflare Worker dashboard, click **Settings** → **Variables**
2. Under **Environment Variables**, add:
   - Variable name: `OPENAI_API_KEY`, Value: your OpenAI API key
   - Variable name: `GEMINI_API_KEY`, Value: your Gemini API key
   - Variable name: `ANTHROPIC_API_KEY`, Value: your Anthropic API key
3. Click **Encrypt** for each (makes them secret)
4. Click **Save and Deploy**

The Worker will automatically access these environment variables as globals (no code changes needed).

5. In your form, you can now omit the `api-key` parameter (or provide it as fallback):

```
custom-llm-conversations(
    provider=openai,
    proxy-url=https://your-worker.workers.dev
)
```

## Field Plugin Configuration

### Basic Configuration with Proxy

```
custom-llm-conversations(
    provider=openai,
    api-key=your_api_key,
    proxy-url=https://your-worker.workers.dev,
    model=gpt-4o-mini,
    system_prompt="Your instructions here"
)
```

### Parameters Reference

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `provider` | No | AI provider to use | `openai`, `gemini`, `anthropic` (default: `openai`) |
| `api-key` | Yes* | API key for the provider | `sk-...` or `AIza...` or `sk-ant-...` |
| `proxy-url` | Conditional** | Your proxy server URL | `https://your-worker.workers.dev` |
| `model` | No | Specific model to use | `gpt-4o-mini`, `gemini-2.5-flash`, `claude-haiku-4-5-20251001` |

\* Can be omitted if stored in Worker environment variables  
\** Required for Google (Gemini) and Anthropic (Claude); optional for OpenAI in Collect

## Provider-Specific Setup

### OpenAI (GPT) Setup

1. **Get API Key**
   - Go to [platform.openai.com](https://platform.openai.com)
   - Sign up or log in
   - Go to **API Keys** → **Create new secret key**
   - Copy and save your key (starts with `sk-`)

2. **Field Configuration**

```
custom-llm-conversations(
    provider=openai,
    api-key=sk-your_key_here,
    model=gpt-4o-mini,
    system_prompt="You are a helpful assistant."
)
```

**Without Proxy (Collect only):**
```
custom-llm-conversations(
    provider=openai,
    api-key=sk-your_key_here,
    model=gpt-4o-mini,
    system_prompt="You are a helpful assistant."
)
```

**With Proxy (Web Collect):**
```
custom-llm-conversations(
    provider=openai,
    api-key=sk-your_key_here,
    proxy-url=https://your-worker.workers.dev,
    model=gpt-4o-mini,
    system_prompt="You are a helpful assistant."
)
```

3. **Recommended Models**
   - `gpt-4o-mini` - Fast, affordable (recommended)
   - `gpt-4o` - Most capable
   - `gpt-3.5-turbo` - Legacy, cheaper

### Google (Gemini) Setup

1. **Get API Key**
   - Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
   - Sign in with your Google account
   - Click **Create API Key**
   - Copy your key (starts with `AIza`)

2. **Field Configuration** (Proxy required)

```
custom-llm-conversations(
    provider=gemini,
    api-key=AIzaYour_key_here,
    proxy-url=https://your-worker.workers.dev,
    model=gemini-2.5-flash,
    system_prompt="You are a helpful assistant."
)
```

3. **Available Models**
   - `gemini-2.5-flash` - Latest fast model (recommended)
   - `gemini-2.5-pro` - Latest, most capable model
   - `gemini-1.5-flash` - Previous generation
   - `gemini-1.5-pro` - Previous generation

### Anthropic (Claude) Setup

1. **Get API Key**
   - Go to [console.anthropic.com](https://console.anthropic.com)
   - Sign up or log in
   - Go to **API Keys** → **Create Key**
   - Copy your key (starts with `sk-ant-`)

2. **Field Configuration** (Proxy required)

```
custom-llm-conversations(
    provider=anthropic,
    api-key=sk-ant-your_key_here,
    proxy-url=https://your-worker.workers.dev,
    model=claude-haiku-4-5-20251001,
    system_prompt="You are a helpful assistant."
)
```

3. **Recommended Models**
   - `claude-haiku-4-5-20251001` - Claude 4.5 Haiku (fastest, recommended)
   - `claude-3-5-sonnet-20240620` - Claude 3.5 Sonnet (balanced)
   - `claude-3-opus-20240229` - Claude 3 Opus (most capable)

## Security Considerations

### API Key Protection

1. **Use Environment Variables** (Recommended)
   - Store keys in Cloudflare Worker settings
   - Never commit keys to version control
   - Rotate keys regularly

2. **Form-Level Keys** (Quick Setup)
   - Use only for testing
   - Consider key rotation
   - Set up usage alerts

### Rate Limiting

Add rate limiting to your Cloudflare Worker:

```javascript
// Example: Simple rate limiting by IP
const RATE_LIMIT = 100 // requests per hour
const rateLimitMap = new Map()

async function checkRateLimit(ip) {
  const now = Date.now()
  const hourAgo = now - 3600000
  
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, [])
  }
  
  const requests = rateLimitMap.get(ip).filter(time => time > hourAgo)
  
  if (requests.length >= RATE_LIMIT) {
    return false
  }
  
  requests.push(now)
  rateLimitMap.set(ip, requests)
  return true
}
```

### Additional Security

1. **Restrict Origins** - Limit CORS to specific domains
2. **Use HTTPS** - Always use HTTPS URLs
3. **Monitor Usage** - Set up usage alerts in provider dashboards
4. **Budget Limits** - Configure spending limits on API accounts

## Troubleshooting

### Common Issues

#### 1. "Failed to fetch" or CORS errors

**Symptoms:** Network errors, CORS policy violations

**Solutions:**
- Verify proxy URL is correct
- Check Cloudflare Worker is deployed
- Ensure CORS headers are set in Worker
- Try accessing Worker URL directly in browser

#### 2. "API key not provided"

**Symptoms:** 401 Unauthorized errors

**Solutions:**
- Verify `api-key` parameter is set
- Check environment variables in Cloudflare
- Ensure key is valid and not expired
- Check key format (OpenAI: `sk-`, Google: `AIza`, Anthropic: `sk-ant-`)

#### 3. "Provider requires proxy server"

**Symptoms:** Error when using Google (Gemini) or Anthropic (Claude) without proxy

**Solutions:**
- Add `proxy-url` parameter
- Google (Gemini) and Anthropic (Claude) ALWAYS require proxy
- Verify proxy URL is accessible

#### 4. Streaming not working

**Symptoms:** Responses don't appear in real-time

**Solutions:**
- Check `streaming-fallback=true` parameter
- Verify proxy forwards streaming headers
- Test with non-streaming mode first
- Check browser compatibility

#### 5. Rate limit errors

**Symptoms:** 429 Too Many Requests

**Solutions:**
- Check your API usage dashboard
- Upgrade your API plan
- Implement request throttling
- Add retry logic with backoff

### Testing Your Setup

#### Test Worker Directly

Use `curl` or Postman to test your Worker:

```bash
curl -X POST https://your-worker.workers.dev \
  -H "Content-Type: application/json" \
  -H "X-Provider: openai" \
  -H "X-API-Key: your_api_key" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Say hello"}
    ],
    "stream": false
  }'
```

#### Test in Field Plugin

1. Start with OpenAI (GPT) (easiest to test)
2. Use a simple system prompt
3. Test with `conversation-starter="Hello"`
4. Check browser console for errors
5. Verify responses appear correctly

### Getting Help

If you're still having issues:

1. Check the [SurveyCTO Support Forum](https://support.surveycto.com)
2. Review Cloudflare Worker logs (available in dashboard)
3. Check provider status pages:
   - [OpenAI Status](https://status.openai.com)
   - [Google Cloud Status](https://status.cloud.google.com)
   - [Anthropic Status](https://status.anthropic.com)

## Advanced Configuration

### Custom Worker Modifications

You can customize the Worker for your needs:

#### Add Authentication

```javascript
async function handleRequest(request) {
  const authToken = request.headers.get('Authorization')
  if (authToken !== 'Bearer your-secret-token') {
    return new Response('Unauthorized', { status: 401 })
  }
  // ... rest of code
}
```

#### Add Logging

```javascript
async function handleOpenAI(requestBody, apiKey) {
  console.log('OpenAI request:', {
    model: requestBody.model,
    timestamp: new Date().toISOString()
  })
  // ... rest of code
}
```

#### Add Usage Tracking

```javascript
// Use Cloudflare KV or Durable Objects to track usage
async function trackUsage(provider, tokens) {
  await USAGE_KV.put(
    `usage:${provider}:${new Date().toISOString().split('T')[0]}`,
    tokens,
    { expirationTtl: 86400 * 30 } // 30 days
  )
}
```

## Cost Estimates

### Cloudflare Workers
- **Free Tier:** 100,000 requests/day
- **Paid:** $5/month for 10 million requests

### AI Provider Costs (Approximate)

**OpenAI (GPT):**
- GPT-4o-mini: ~$0.15 per 1M input tokens
- GPT-4o: ~$2.50 per 1M input tokens

**Google (Gemini):**
- Gemini 2.5 Flash: Free tier available, then ~$0.50 per 1M tokens

**Anthropic (Claude):**
- Claude 3.5 Sonnet: ~$3 per 1M input tokens
- Claude 3 Haiku: ~$0.25 per 1M input tokens

**Typical usage:** A 10-minute conversation might use 1,000-5,000 tokens (~$0.001-$0.01 per conversation with mid-tier models).

## Conclusion

Using a proxy server with this field plug-in enables:
- ✅ Full multi-provider support—OpenAI (GPT), Google (Gemini), Anthropic (Claude)
- ✅ CORS-free operation in web browsers
- ✅ Secure API key management
- ✅ Centralized rate limiting and monitoring
- ✅ Easy deployment with Cloudflare Workers

For most use cases, we recommend:
1. Start with OpenAI (GPT) and Cloudflare Workers
2. Store API keys in Worker environment variables
3. Test thoroughly before deploying to production
4. Monitor usage and set budget limits

