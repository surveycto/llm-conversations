/**
 * Cloudflare Worker - AI Provider Proxy
 * 
 * This worker acts as a proxy for OpenAI, Gemini, and Anthropic APIs
 * It allows SurveyCTO field plugins to bypass CORS restrictions
 * and optionally store API keys securely in environment variables
 */

// Provider API endpoints
const PROVIDER_ENDPOINTS = {
    openai: 'https://api.openai.com/v1/chat/completions',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent',
    anthropic: 'https://api.anthropic.com/v1/messages'
}

// Provider API versions
const PROVIDER_VERSIONS = {
    anthropic: '2023-06-01'
}

/**
 * Main request handler
 */
addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request))
})

/**
 * Handle incoming requests
 */
async function handleRequest(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return handleCORS()
    }

    // Only allow POST requests
    if (request.method !== 'POST') {
        return new Response('Method not allowed', {
            status: 405,
            headers: getCORSHeaders()
        })
    }

    try {
        // Get provider from header
        const provider = request.headers.get('X-Provider') || 'openai'

        // Validate provider
        if (!PROVIDER_ENDPOINTS[provider]) {
            return jsonResponse({ error: 'Unsupported provider: ' + provider }, 400)
        }

        // Get API key (from header or environment variable)
        let apiKey = request.headers.get('X-API-Key')

        // If no API key in header, try environment variables
        // Environment variables are accessed as globals in Cloudflare Workers
        if (!apiKey) {
            // Use globalThis to access environment variables (TypeScript-safe)
            if (provider === 'openai' && typeof globalThis.OPENAI_API_KEY !== 'undefined') {
                apiKey = globalThis.OPENAI_API_KEY
            } else if (provider === 'gemini' && typeof globalThis.GEMINI_API_KEY !== 'undefined') {
                apiKey = globalThis.GEMINI_API_KEY
            } else if (provider === 'anthropic' && typeof globalThis.ANTHROPIC_API_KEY !== 'undefined') {
                apiKey = globalThis.ANTHROPIC_API_KEY
            }
        }

        if (!apiKey) {
            return jsonResponse({ error: 'API key not provided' }, 401)
        }

        // Get request body with error handling
        let requestBody
        try {
            const text = await request.text()
            if (!text || text.trim() === '') {
                return jsonResponse({ error: 'Request body is empty' }, 400)
            }
            requestBody = JSON.parse(text)
        } catch (e) {
            return jsonResponse({
                error: 'Invalid JSON in request body',
                details: e.message
            }, 400)
        }

        // Route to appropriate provider
        switch (provider) {
            case 'openai':
                return await handleOpenAI(requestBody, apiKey)
            case 'gemini':
                return await handleGemini(requestBody, apiKey)
            case 'anthropic':
                return await handleAnthropic(requestBody, apiKey)
            default:
                return jsonResponse({ error: 'Unsupported provider' }, 400)
        }
    } catch (error) {
        console.error('Proxy error:', error)
        return jsonResponse({
            error: 'Proxy error: ' + error.message
        }, 500)
    }
}

/**
 * Handle OpenAI API requests
 */
async function handleOpenAI(requestBody, apiKey) {
    const response = await fetch(PROVIDER_ENDPOINTS.openai, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify(requestBody)
    })

    // For streaming responses, pass through
    if (requestBody.stream) {
        return new Response(response.body, {
            status: response.status,
            headers: {
                ...getCORSHeaders(),
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            }
        })
    }

    // For non-streaming, parse and return JSON
    const data = await response.json()
    return jsonResponse(data, response.status)
}

/**
 * Handle Gemini API requests by transforming its stream to SSE
 */
async function handleGemini(requestBody, apiKey) {
    // Normalize model path to avoid models/models/... duplication
    const rawModel = requestBody.model || 'gemini-2.5-flash'
    const modelPath = rawModel.startsWith('models/') ? rawModel : 'models/' + rawModel
    const isStream = !!requestBody.stream

    // CRITICAL: Add ?alt=sse for streaming to get proper SSE format
    const path = isStream ? ':streamGenerateContent' : ':generateContent'
    const altParam = isStream ? '&alt=sse' : ''
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/${modelPath}${path}?key=${encodeURIComponent(apiKey)}${altParam}`

    // Gemini API doesn't want 'model' or 'stream' in the body
    const { model: _, stream: __, ...geminiRequestBody } = requestBody

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiRequestBody)
    })

    // Log for debugging
    console.log('Gemini request:', { model: modelPath, isStream, endpoint: endpoint.replace(apiKey, '***') })

    // Handle non-OK responses for both stream and non-stream
    if (!response.ok) {
        const errorText = await response.text()
        console.error('Gemini error:', response.status, errorText)
        return new Response(errorText, {
            status: response.status,
            headers: { ...getCORSHeaders(), 'Content-Type': 'application/json' }
        })
    }

    // Handle non-streaming separately
    if (!isStream) {
        const data = await response.json()
        return jsonResponse(data, response.status) // jsonResponse includes CORS
    }

    // Transform Gemini's SSE stream into OpenAI-compatible SSE
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()

    // Helper to extract all text parts safely from a Gemini chunk
    function extractText(chunk) {
        const parts = chunk?.candidates?.[0]?.content?.parts
        if (Array.isArray(parts)) {
            return parts.map(p => p.text || '').join('')
        }
        return ''
    }

    ; (async () => {
        let buffer = ''
        let chunkCount = 0
        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) {
                    console.log(`Gemini stream complete. Total chunks: ${chunkCount}`)
                    break
                }

                buffer += decoder.decode(value, { stream: true })

                // Process buffer line-by-line (Gemini uses SSE format with "data:" prefix)
                let lines = buffer.split('\n')
                buffer = lines.pop() || '' // Keep any partial line for the next chunk

                for (const line of lines) {
                    const trimmed = line.trim()

                    // Skip empty lines and non-data lines
                    if (!trimmed || !trimmed.startsWith('data:')) continue

                    // Extract JSON payload after "data: "
                    const payload = trimmed.slice(5).trim()
                    if (!payload || payload === '[DONE]') continue

                    try {
                        const geminiChunk = JSON.parse(payload)

                        // Check for errors in the chunk
                        if (geminiChunk.error) {
                            console.error('Error in Gemini stream:', geminiChunk.error.message)
                            continue
                        }

                        // Extract text from all parts
                        const text = extractText(geminiChunk)
                        if (text) {
                            chunkCount++
                            const sseChunk = { choices: [{ delta: { content: text } }] }
                            await writer.write(encoder.encode(`data: ${JSON.stringify(sseChunk)}\n\n`))
                        }
                    } catch (e) {
                        // Incomplete JSON or parse error, skip this line
                        console.error('Error parsing Gemini chunk:', e.message, 'Line:', trimmed.substring(0, 100))
                    }
                }
            }
        } catch (e) {
            console.error('Error processing Gemini stream:', e)
        } finally {
            if (chunkCount === 0) {
                console.warn('Warning: No chunks were extracted from Gemini stream')
            }
            await writer.write(encoder.encode('data: [DONE]\n\n'))
            await writer.close()
        }
    })()

    return new Response(readable, {
        status: 200,
        headers: {
            ...getCORSHeaders(),
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    })
}

/**
 * Handle Anthropic API requests
 */
async function handleAnthropic(requestBody, apiKey) {
    const response = await fetch(PROVIDER_ENDPOINTS.anthropic, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': PROVIDER_VERSIONS.anthropic
        },
        body: JSON.stringify(requestBody)
    })

    // Non-streaming: forward as JSON (with CORS headers)
    if (!requestBody.stream) {
        if (!response.ok) { // Forward error
            const errorText = await response.text()
            return new Response(errorText, { status: response.status, headers: { ...getCORSHeaders(), 'Content-Type': 'application/json' } })
        }
        const data = await response.json()
        return jsonResponse(data, response.status)
    }

    if (!response.ok) {
        const errorText = await response.text()
        return new Response(errorText, { status: response.status, headers: { ...getCORSHeaders(), 'Content-Type': 'application/json' } })
    }

    // Transform Anthropic SSE into OpenAI-compatible SSE
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()

        ; (async () => {
            let buffer = ''
            try {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break

                    buffer += decoder.decode(value, { stream: true })

                    let lastNewline = buffer.lastIndexOf('\n')
                    if (lastNewline === -1) continue

                    const chunkText = buffer.slice(0, lastNewline)
                    buffer = buffer.slice(lastNewline + 1)

                    const lines = chunkText.split('\n')
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i].trim()
                        if (!line.startsWith('data:')) continue

                        const payload = line.slice(5).trim()
                        if (payload === '[DONE]') continue

                        try {
                            const anthropicChunk = JSON.parse(payload)
                            if (anthropicChunk.type === 'content_block_delta' && anthropicChunk.delta?.type === 'text_delta') {
                                const text = anthropicChunk.delta.text
                                if (text) {
                                    const sseChunk = { choices: [{ delta: { content: text } }] }
                                    await writer.write(encoder.encode(`data: ${JSON.stringify(sseChunk)}\n\n`))
                                }
                            }
                        } catch (e) {
                            // Ignore parse errors, wait for more data
                        }
                    }
                }
            } finally {
                await writer.write(encoder.encode('data: [DONE]\n\n'))
                await writer.close()
            }
        })()

    return new Response(readable, {
        status: 200,
        headers: {
            ...getCORSHeaders(),
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    })
}

/**
 * Handle CORS preflight requests
 */
function handleCORS() {
    return new Response(null, {
        status: 204,
        headers: getCORSHeaders()
    })
}

/**
 * Get CORS headers
 */
function getCORSHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Provider, X-API-Key',
        'Access-Control-Max-Age': '86400'
    }
}

/**
 * Return JSON response with CORS headers
 */
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status: status,
        headers: {
            ...getCORSHeaders(),
            'Content-Type': 'application/json'
        }
    })
}

/**
 * Environment variable configuration:
 * 
 * You can optionally store API keys in Cloudflare Worker environment variables
 * instead of passing them from the form. This is more secure for production.
 * 
 * To use this feature:
 * 1. In Cloudflare Workers dashboard, go to your worker settings
 * 2. Click on "Settings" → "Variables"
 * 3. Add environment variables:
 *    - Variable name: OPENAI_API_KEY, Value: your_openai_key (click "Encrypt")
 *    - Variable name: GEMINI_API_KEY, Value: your_gemini_key (click "Encrypt")
 *    - Variable name: ANTHROPIC_API_KEY, Value: your_anthropic_key (click "Encrypt")
 * 4. Click "Save and Deploy"
 * 
 * The worker will automatically access these via globalThis when the X-API-Key
 * header is not provided in the request.
 */

