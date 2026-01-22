/* global fieldProperties, setAnswer, getPluginParameter */
/* API Provider Configurations and Adapters */

/**
 * Provider configurations for OpenAI, Gemini, and Anthropic
 * Each provider has its own API format and streaming implementation
 */

var API_PROVIDERS = {
    openai: {
        name: 'OpenAI',
        directSupported: true,
        endpoint: 'https://api.openai.com/v1/chat/completions',
        defaultModel: 'gpt-4o-mini'
    },
    gemini: {
        name: 'Google Gemini',
        directSupported: false,
        endpoint: null, // Must use proxy
        defaultModel: 'gemini-2.5-flash'
    },
    anthropic: {
        name: 'Anthropic Claude',
        directSupported: false,
        endpoint: null, // Must use proxy
        defaultModel: 'claude-haiku-4-5-20251001'
    }
}

/**
 * OpenAI API Adapter
 */
var OpenAIAdapter = {
    /**
     * Format messages for OpenAI API
     */
    formatRequest: function (messages, systemPrompt, model, maxTokens) {
        var requestBody = {
            model: model || API_PROVIDERS.openai.defaultModel,
            messages: [
                { role: 'system', content: systemPrompt }
            ].concat(messages),
            temperature: 0.7,
            stream: true
        }

        // Use max_completion_tokens for newer models, max_tokens for legacy
        if (usesMaxCompletionTokens(model)) {
            requestBody.max_completion_tokens = maxTokens || 1000
        } else {
            requestBody.max_tokens = maxTokens || 1000
        }

        return requestBody
    },

    /**
     * Parse streaming response from OpenAI
     */
    parseStreamChunk: function (line) {
        if (line === '' || line === 'data: [DONE]') {
            return null
        }

        if (line.startsWith('data: ')) {
            try {
                var data = JSON.parse(line.substring(6))
                var content = data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content
                return content || null
            } catch (e) {
                return null
            }
        }

        return null
    },

    /**
     * Parse non-streaming response from OpenAI
     */
    parseResponse: function (data) {
        return data.choices[0].message.content
    },

    /**
     * Parse error response
     */
    parseError: function (errorData) {
        return errorData.error?.message || 'Unknown error'
    }
}

/**
 * Gemini API Adapter
 */
var GeminiAdapter = {
    /**
     * Format messages for Gemini API
     * Gemini uses a different message format than OpenAI
     */
    formatRequest: function (messages, systemPrompt, model) {
        // Gemini combines system prompt with first user message
        var contents = []
        var systemInstruction = systemPrompt

        // Convert messages to Gemini format
        messages.forEach(function (msg) {
            if (msg.role === 'user') {
                contents.push({
                    role: 'user',
                    parts: [{ text: msg.content }]
                })
            } else if (msg.role === 'assistant') {
                contents.push({
                    role: 'model',
                    parts: [{ text: msg.content }]
                })
            }
        })

        return {
            model: model || API_PROVIDERS.gemini.defaultModel,
            contents: contents,
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            },
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1000
            }
        }
    },

    /**
     * Parse streaming response from Gemini
     */
    parseStreamChunk: function (line) {
        if (line === '' || line === 'data: [DONE]') {
            return null
        }
        if (line.startsWith('data: ')) {
            try {
                var data = JSON.parse(line.substring(6))
                var content = data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content
                return content || null
            } catch (e) {
                return null
            }
        }
        return null
    },

    /**
     * Parse non-streaming response from Gemini
     */
    parseResponse: function (data) {
        if (data.candidates && data.candidates[0]) {
            var candidate = data.candidates[0]
            if (candidate.content && candidate.content.parts) {
                return candidate.content.parts[0].text
            }
        }
        throw new Error('Invalid Gemini response format')
    },

    /**
     * Parse error response
     */
    parseError: function (errorData) {
        return errorData.error?.message || errorData.message || 'Unknown error'
    }
}

/**
 * Anthropic API Adapter
 */
var AnthropicAdapter = {
    /**
     * Format messages for Anthropic API
     * Anthropic uses a different message format than OpenAI
     */
    formatRequest: function (messages, systemPrompt, model) {
        // Anthropic requires alternating user/assistant messages
        var formattedMessages = []

        messages.forEach(function (msg) {
            if (msg.role === 'user' || msg.role === 'assistant') {
                formattedMessages.push({
                    role: msg.role,
                    content: msg.content
                })
            }
        })

        return {
            model: model || API_PROVIDERS.anthropic.defaultModel,
            max_tokens: 1000,
            system: systemPrompt,
            messages: formattedMessages,
            temperature: 0.7,
            stream: true
        }
    },

    /**
     * Parse streaming response from Anthropic
     */
    parseStreamChunk: function (line) {
        if (line === '' || line === 'data: [DONE]') {
            return null
        }
        if (line.startsWith('data: ')) {
            try {
                var data = JSON.parse(line.substring(6))
                var content = data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content
                return content || null
            } catch (e) {
                return null
            }
        }
        return null
    },

    /**
     * Parse non-streaming response from Anthropic
     */
    parseResponse: function (data) {
        if (data.content && data.content[0]) {
            return data.content[0].text
        }
        throw new Error('Invalid Anthropic response format')
    },

    /**
     * Parse error response
     */
    parseError: function (errorData) {
        return errorData.error?.message || errorData.message || 'Unknown error'
    }
}

/**
 * Get adapter for specified provider
 */
function getProviderAdapter(provider) {
    switch (provider) {
        case 'openai':
            return OpenAIAdapter
        case 'gemini':
            return GeminiAdapter
        case 'anthropic':
            return AnthropicAdapter
        default:
            throw new Error('Unsupported provider: ' + provider)
    }
}

/**
 * Get provider configuration
 */
function getProviderConfig(provider) {
    var config = API_PROVIDERS[provider]
    if (!config) {
        throw new Error('Unsupported provider: ' + provider)
    }
    return config
}

/**
 * Validate provider selection
 */
function validateProvider(provider, proxyUrl) {
    var config = getProviderConfig(provider)

    // Check if provider requires proxy
    if (!config.directSupported && !proxyUrl) {
        throw new Error(config.name + ' requires a proxy server. Please provide the proxy-url parameter.')
    }

    return true
}

