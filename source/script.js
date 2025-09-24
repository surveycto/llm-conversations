/* global fieldProperties, setAnswer, getPluginParameter */

// Detect platform
var isWebCollect = (document.body.className.indexOf('web-collect') >= 0)
var isAndroid = (document.body.className.indexOf('android-collect') >= 0)
var isIOS = (document.body.className.indexOf('ios-collect') >= 0)

// Get DOM elements
var conversationDisplay = document.getElementById('conversation-display')
var userInput = document.getElementById('user-input')
var sendButton = document.getElementById('send-button')
var clearButton = document.getElementById('clear-button')
var completeButton = document.getElementById('complete-button')
var loadingIndicator = document.getElementById('loading-indicator')
var conversationData = document.getElementById('conversation-data')
var suggestedPromptsContainer = document.getElementById('suggested-prompts')

// Get parameters from SurveyCTO fields and plugin parameters
var SYSTEM_PROMPT = getPluginParameter('system_prompt') || ''
var CASE_DATA = getPluginParameter('case_data') || ''
var MODEL = getPluginParameter('model') || getDefaultModel()
var OPENAI_API_KEY = getPluginParameter('api-key') || ''
var CLEAR_BUTTON_LABEL = getPluginParameter('clear-button-label') || ''
var COMPLETE_BUTTON_LABEL = getPluginParameter('complete-button-label') || '✓'
var CLEAR_WARNING_TEXT = getPluginParameter('clear-warning-text') || 'Are you sure you want to clear the entire conversation? This action cannot be undone.'
var COMPLETE_WARNING_TEXT = getPluginParameter('complete-warning-text') || 'Are you sure you want to complete this conversation? You will not be able to add more messages.'
var SUGGESTED_PROMPTS = getPluginParameter('suggested-prompts') || ''
var END_MESSAGE = getPluginParameter('end-message') || 'Thank you for your participation.'
var CONVERSATION_STARTER = getPluginParameter('conversation-starter') || 'Please begin the conversation as instructed.'
var REQUEST_TIMEOUT = parseInt(getPluginParameter('request-timeout')) || 30000 // 30 seconds
var MAX_RETRIES = parseInt(getPluginParameter('max-retries')) || 3
var RETRY_DELAY = getPluginParameter('retry-delay') || 2000 // 2 seconds
var STREAM_TIMEOUT = getPluginParameter('stream-timeout') || 15000 // 15 seconds between chunks
var STREAM_MAX_WAIT = getPluginParameter('stream-max-wait') || 60000 // 60 seconds total
var ENABLE_STREAMING_FALLBACK = getPluginParameter('streaming-fallback') !== 'false' // default true
// OpenAI is the only supported provider
var SEND_BUTTON_LABEL = getPluginParameter('send-button-label') || 'Send'

// Conversation state
var conversationState = {
    messages: [],
    initialized: false,
    completed: false
}

var INPUT_SAVE_KEY = 'chatbot_unsent_input'
var fieldName = fieldProperties.FIELD_NAME || 'chatbot_field'
var TIMEOUT_SECONDS = parseInt(getPluginParameter('timeout')) || 600
var timeoutTimer = null
var lastActivityTime = Date.now()
var isTimedOut = false

// Get default OpenAI model
function getDefaultModel() {
    return 'gpt-4o-mini'
}

// Prefer max_completion_tokens for everything except known legacy families
function usesMaxCompletionTokens(model) {
    var m = (model || '').toLowerCase()
    // Known legacy chat/completions models that still expect max_tokens
    var legacyFamilies = [
        /^gpt-3\.5/,                                  // gpt-3.5-turbo*
        /^gpt-4($|-\d{4}|-0613|-1106|-0125)/          // classic gpt-4 snapshots (not 4o/4-turbo)
    ]
    return !legacyFamilies.some(function (re) { return re.test(m) })
}

// Build complete system prompt (combines system prompt + case data)
function buildCompleteSystemPrompt() {
    var completePrompt = SYSTEM_PROMPT

    if (CASE_DATA && CASE_DATA.trim().length > 0) {
        completePrompt += '\n\n' + CASE_DATA
    }

    return completePrompt
}

// Validate required parameters
function validateParameters() {
    var errors = []

    if (!SYSTEM_PROMPT) {
        errors.push('System prompt is required')
    }

    if (!OPENAI_API_KEY) {
        errors.push('OpenAI API key is required')
    }

    return errors
}

// Handle HTML entities in labels and hints
function unEntity(str) {
    return str.replace(/</g, '<').replace(/>/g, '>')
}

if (fieldProperties.LABEL) {
    document.querySelector('.label').innerHTML = unEntity(fieldProperties.LABEL)
}
if (fieldProperties.HINT) {
    document.querySelector('.hint').innerHTML = unEntity(fieldProperties.HINT)
}

// Auto-resize textarea based on content
function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto'
    var scrollHeight = textarea.scrollHeight
    var maxHeight = 120 // Match CSS max-height

    if (scrollHeight > maxHeight) {
        textarea.style.height = maxHeight + 'px'
        textarea.style.overflowY = 'auto'
    } else {
        textarea.style.height = scrollHeight + 'px'
        textarea.style.overflowY = 'hidden'
    }
}

// Initialize auto-resize for textarea
function initializeTextareaAutoResize() {
    if (userInput) {
        // Set initial height
        autoResizeTextarea(userInput)

        // Add event listeners for auto-resize
        userInput.addEventListener('input', function () {
            autoResizeTextarea(this)
        })

        userInput.addEventListener('paste', function () {
            // Delay to allow paste content to be processed
            setTimeout(function () {
                autoResizeTextarea(userInput)
            }, 0)
        })
    }
}

// Enhanced fetch with timeout
async function fetchWithTimeout(url, options, timeout = REQUEST_TIMEOUT) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        })
        clearTimeout(timeoutId)
        return response
    } catch (error) {
        clearTimeout(timeoutId)
        if (error.name === 'AbortError') {
            throw new Error('Request timed out after ' + (timeout / 1000) + ' seconds')
        }
        throw error
    }
}

// Send message to OpenAI with streaming support and enhanced timeout handling
async function sendToOpenAI(messages, onStreamChunk) {
    if (!OPENAI_API_KEY) {
        throw new Error('OpenAI API key not provided')
    }

    var requestBody = {
        model: MODEL,
        messages: messages,
        temperature: 0.7,
        stream: !!onStreamChunk
    }

    if (usesMaxCompletionTokens(MODEL)) {
        requestBody.max_completion_tokens = 1000
    } else {
        requestBody.max_tokens = 1000
    }

    var response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + OPENAI_API_KEY
        },
        body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
        var errorText = await response.text()
        var errorData
        try {
            errorData = JSON.parse(errorText)
        } catch (e) {
            throw new Error('HTTP ' + response.status + ': ' + response.statusText)
        }
        throw new Error('OpenAI API error: ' + (errorData.error?.message || response.statusText))
    }

    // Handle non-streaming response
    if (!onStreamChunk) {
        var data = await response.json()
        return data.choices[0].message.content
    }

    // Handle streaming response with enhanced timeout handling
    var reader = response.body.getReader()
    var decoder = new TextDecoder()
    var fullResponse = ''
    var streamStartTime = Date.now()
    var lastChunkTime = Date.now()

    try {
        while (true) {
            // Check total stream time
            if (Date.now() - streamStartTime > STREAM_MAX_WAIT) {
                throw new Error('Stream exceeded maximum wait time of ' + (STREAM_MAX_WAIT / 1000) + ' seconds')
            }

            // Create a timeout promise for individual reads
            var readPromise = reader.read()
            var timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error('Stream chunk timeout after ' + (STREAM_TIMEOUT / 1000) + ' seconds'))
                }, STREAM_TIMEOUT)
            })

            var done, value
            try {
                var result = await Promise.race([readPromise, timeoutPromise])
                done = result.done
                value = result.value
            } catch (timeoutError) {
                // Check if we've been waiting too long since last chunk
                if (Date.now() - lastChunkTime > STREAM_TIMEOUT) {
                    throw timeoutError
                } else {
                    // Short timeout, try once more
                    var result = await reader.read()
                    done = result.done
                    value = result.value
                }
            }

            if (done) break

            lastChunkTime = Date.now()
            var chunk = decoder.decode(value, { stream: true })
            var lines = chunk.split('\n')

            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim()
                if (line === '' || line === 'data: [DONE]') continue

                if (line.startsWith('data: ')) {
                    try {
                        var data = JSON.parse(line.substring(6))
                        var content = data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content

                        if (content) {
                            fullResponse += content
                            if (onStreamChunk) {
                                onStreamChunk(content, fullResponse)
                            }
                        }
                    } catch (e) {
                        // Skip invalid JSON chunks
                        continue
                    }
                }
            }
        }
    } finally {
        reader.releaseLock()
    }

    // Ensure we got some response
    if (!fullResponse.trim()) {
        throw new Error('Empty response received from stream')
    }

    return fullResponse
}

// Retry wrapper with exponential backoff
async function sendToOpenAIWithRetry(messages, onStreamChunk, retryCount = 0) {
    try {
        return await sendToOpenAI(messages, onStreamChunk)
    } catch (error) {
        if (retryCount < MAX_RETRIES) {
            var delay = RETRY_DELAY * Math.pow(2, retryCount) // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, delay))
            return await sendToOpenAIWithRetry(messages, onStreamChunk, retryCount + 1)
        } else {
            throw new Error('Failed after ' + (MAX_RETRIES + 1) + ' attempts: ' + error.message)
        }
    }
}

// Fallback handler for streaming issues
async function sendToOpenAIWithFallback(messages, onStreamChunk, useStreaming = true) {
    if (!useStreaming || !ENABLE_STREAMING_FALLBACK) {
        return await sendToOpenAIWithRetry(messages, onStreamChunk)
    }

    try {
        return await sendToOpenAIWithRetry(messages, onStreamChunk)
    } catch (error) {
        if (error.message.includes('timeout') || error.message.includes('Stream') || error.message.includes('chunk')) {
            return await sendToOpenAIWithRetry(messages, null) // null = no streaming
        }
        throw error
    }
}

// Add streaming message to UI
function addStreamingMessageToUI(role, initialContent) {
    var messageDiv = document.createElement('div')
    var messageClass = 'message ' + (role === 'user' ? 'user-message' : 'bot-message')
    messageDiv.className = messageClass

    var contentDiv = document.createElement('div')
    contentDiv.className = 'message-content'
    contentDiv.textContent = initialContent || ''

    messageDiv.appendChild(contentDiv)
    conversationDisplay.appendChild(messageDiv)

    // Add typing indicator
    var typingIndicator = document.createElement('span')
    typingIndicator.className = 'typing-indicator'
    typingIndicator.textContent = '▋'
    contentDiv.appendChild(typingIndicator)

    conversationDisplay.scrollTop = conversationDisplay.scrollHeight

    return {
        messageDiv: messageDiv,
        contentDiv: contentDiv,
        typingIndicator: typingIndicator
    }
}

// Update streaming message content
function updateStreamingMessage(messageElements, newContent, fullContent) {
    var contentDiv = messageElements.contentDiv
    var typingIndicator = messageElements.typingIndicator

    // Remove typing indicator temporarily
    if (typingIndicator && typingIndicator.parentNode) {
        typingIndicator.remove()
    }

    // Update content - use innerHTML for bot messages to support markdown
    contentDiv.innerHTML = parseMarkdown(fullContent)

    // Add typing indicator back
    contentDiv.appendChild(typingIndicator)

    // Auto-scroll to bottom
    conversationDisplay.scrollTop = conversationDisplay.scrollHeight
}

// Finish streaming message
function finishStreamingMessage(messageElements, finalContent) {
    var contentDiv = messageElements.contentDiv
    var typingIndicator = messageElements.typingIndicator

    // Remove typing indicator
    if (typingIndicator && typingIndicator.parentNode) {
        typingIndicator.remove()
    }

    // Set final content - use innerHTML for bot messages to support markdown
    contentDiv.innerHTML = parseMarkdown(finalContent)

    // Final scroll
    conversationDisplay.scrollTop = conversationDisplay.scrollHeight
}

// Parse markdown to HTML
function parseMarkdown(text) {
    if (!text) return ''

    // Escape HTML to prevent XSS, but we'll selectively unescape our markdown
    var html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')

    // Convert LaTeX math expressions first (before other markdown)
    // Inline math: \( ... \)
    html = html.replace(/\\?\\\(\s*(.*?)\s*\\?\\\)/g, function (match, mathContent) {
        return '<span class="math-inline" title="Math: ' + mathContent.replace(/"/g, '&quot;') + '">' +
            mathContent + '</span>'
    })

    // Block math: \[ ... \]
    html = html.replace(/\\?\\\[\s*(.*?)\s*\\?\\\]/gs, function (match, mathContent) {
        return '<div class="math-block" title="Math: ' + mathContent.replace(/"/g, '&quot;') + '">' +
            mathContent + '</div>'
    })

    // Headers (### ## #)
    html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>')
    html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>')
    html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>')

    // Bold text: **text** or __text__
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    html = html.replace(/__(.*?)__/g, '<strong>$1</strong>')

    // Italic text: *text* or _text_
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')
    html = html.replace(/_(.*?)_/g, '<em>$1</em>')

    // Code blocks: ```code```
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')

    // Inline code: `code`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

    // Line breaks: double line breaks become paragraphs
    html = html.replace(/\n\n+/g, '</p><p>')
    html = '<p>' + html + '</p>'

    // Single line breaks within paragraphs
    html = html.replace(/\n/g, '<br>')

    // Clean up empty paragraphs
    html = html.replace(/<p><\/p>/g, '')
    html = html.replace(/<p>\s*<\/p>/g, '')

    // Lists - improved handling
    // First, handle ordered lists
    html = html.replace(/^[\s]*(\d+)\.\s+(.*)$/gm, '<li data-list-type="ol">$2</li>')

    // Then handle unordered lists  
    html = html.replace(/^[\s]*[-*+]\s+(.*)$/gm, '<li data-list-type="ul">$1</li>')

    // Group consecutive list items into proper list tags
    html = html.replace(/(<li data-list-type="ul">.*?<\/li>)(?:\s*<li data-list-type="ul">.*?<\/li>)*/gs, function (match) {
        var items = match.replace(/data-list-type="ul"/g, '').trim()
        return '<ul>' + items + '</ul>'
    })

    html = html.replace(/(<li data-list-type="ol">.*?<\/li>)(?:\s*<li data-list-type="ol">.*?<\/li>)*/gs, function (match) {
        var items = match.replace(/data-list-type="ol"/g, '').trim()
        return '<ol>' + items + '</ol>'
    })

    return html
}

// Detect special codes in AI response (flexible pattern matching)
function detectSpecialCodes(aiResponse) {
    var trimmedResponse = aiResponse.trim()

    // Look for standalone codes
    var endCodePatterns = [
        /^5j3k$/,
        /^x7y8$/,
        /^END_CONVERSATION$/,
        /^TERMINATE$/,
        /^COMPLETE$/
    ]

    for (var i = 0; i < endCodePatterns.length; i++) {
        if (endCodePatterns[i].test(trimmedResponse)) {
            return {
                detected: true,
                code: trimmedResponse,
                type: 'end_conversation'
            }
        }
    }

    // Look for codes within text (e.g., "Thank you. Code escape: 5j3k")
    var codeInTextPatterns = [
        /(?:code|escape):\s*([a-zA-Z0-9]+)/i,
        /code\s+escape:\s*([a-zA-Z0-9]+)/i
    ]

    for (var i = 0; i < codeInTextPatterns.length; i++) {
        var match = trimmedResponse.match(codeInTextPatterns[i])
        if (match) {
            return {
                detected: true,
                code: match[1],
                type: 'end_conversation',
                hasText: true,
                cleanResponse: trimmedResponse.replace(codeInTextPatterns[i], '').trim()
            }
        }
    }

    return { detected: false, code: null, type: null }
}

// Handle conversation completion
function handleConversationEnd(specialCode) {

    conversationState.completed = true

    // If there's text with the code, show the cleaned version
    if (specialCode.hasText && specialCode.cleanResponse) {
        addMessageToUI('assistant', specialCode.cleanResponse, true)
    }

    // Add completion message
    addMessageToUI('assistant', END_MESSAGE, true)

    // Disable input
    userInput.disabled = true
    sendButton.disabled = true
    if (clearButton) clearButton.disabled = true
    if (completeButton) completeButton.style.display = 'none'

    conversationState.messages.push({ role: 'system', content: '__CONVERSATION_COMPLETED__' })
    saveConversation()
}

// Generate response with streaming
async function generateResponseWithStreaming(userMessage, onStreamChunk) {
    var completeSystemPrompt = buildCompleteSystemPrompt()

    var messages = [
        { role: 'system', content: completeSystemPrompt },
        ...conversationState.messages,
        { role: 'user', content: userMessage }
    ]

    return await sendToOpenAIWithFallback(messages, onStreamChunk)
}

// Generate initial response with streaming
async function generateInitialResponseWithStreaming(onStreamChunk) {
    var completeSystemPrompt = buildCompleteSystemPrompt()

    var messages = [
        { role: 'system', content: completeSystemPrompt },
        { role: 'user', content: CONVERSATION_STARTER }
    ]

    return await sendToOpenAIWithFallback(messages, onStreamChunk)
}

// Add message to UI (for non-streaming messages)
function addMessageToUI(role, content, animate) {
    var messageDiv = document.createElement('div')
    var messageClass = 'message '

    if (role === 'user') {
        messageClass += 'user-message'
    } else {
        messageClass += 'bot-message'
    }

    messageDiv.className = messageClass

    var contentDiv = document.createElement('div')
    contentDiv.className = 'message-content'

    // Use innerHTML for bot messages to support markdown, textContent for user messages for security
    if (role === 'user') {
        contentDiv.textContent = content
    } else {
        contentDiv.innerHTML = parseMarkdown(content)
    }

    messageDiv.appendChild(contentDiv)
    conversationDisplay.appendChild(messageDiv)

    if (animate) {
        contentDiv.style.opacity = '0'
        contentDiv.style.transform = 'translateY(10px)'
        setTimeout(function () {
            contentDiv.style.transition = 'opacity 0.3s, transform 0.3s'
            contentDiv.style.opacity = '1'
            contentDiv.style.transform = 'translateY(0)'
        }, 10)
    }

    conversationDisplay.scrollTop = conversationDisplay.scrollHeight
}

// Handle sending a message with enhanced error handling
async function sendMessage() {
    var message = userInput.value.trim()

    if (isTimedOut || conversationState.completed) {
        return
    }

    if (!message) return

    userInput.disabled = true
    sendButton.disabled = true
    loadingIndicator.style.display = 'block'

    var streamingElements = null
    var useStreaming = true

    try {
        conversationState.messages.push({ role: 'user', content: message })
        addMessageToUI('user', message, true)
        userInput.value = ''
        autoResizeTextarea(userInput) // Reset textarea height

        var fullResponse

        if (useStreaming) {
            // Hide loading indicator for streaming
            loadingIndicator.style.display = 'none'

            // Create streaming message UI
            streamingElements = addStreamingMessageToUI('assistant', '')

            // Generate response with streaming
            fullResponse = await generateResponseWithStreaming(message, function (chunk, fullContent) {
                updateStreamingMessage(streamingElements, chunk, fullContent)
            })

            // Finish streaming
            finishStreamingMessage(streamingElements, fullResponse)
        } else {
            // Non-streaming fallback
            loadingIndicator.querySelector('span').textContent = 'Getting response...'

            fullResponse = await generateResponseWithStreaming(message, null)

            loadingIndicator.style.display = 'none'
            addMessageToUI('assistant', fullResponse, true)
        }

        // Check for special codes in complete response
        var specialCode = detectSpecialCodes(fullResponse)
        if (specialCode.detected) {
            handleConversationEnd(specialCode)
        } else {
            conversationState.messages.push({ role: 'assistant', content: fullResponse })
        }

        saveConversation()
        updateButtonVisibility()
        clearUnsentInput()

    } catch (error) {
        console.error('Error sending message:', error)

        // Remove the failed user message from conversation state
        if (conversationState.messages.length > 0 &&
            conversationState.messages[conversationState.messages.length - 1].content === message) {
            conversationState.messages.pop()
        }

        // Clean up streaming UI if it exists
        if (streamingElements && streamingElements.messageDiv) {
            streamingElements.messageDiv.remove()
        }

        // Determine error type and provide user-friendly message
        var errorMessage = 'Connection error. Please check your internet connection and try again.'
        if (error.message.includes('timeout') || error.message.includes('Stream') || error.message.includes('chunk')) {
            errorMessage = 'Connection interrupted. Your message was saved - please try sending again.'
            useStreaming = false // Try non-streaming on next attempt
        } else if (error.message.includes('Failed after')) {
            errorMessage = 'Unable to connect after multiple attempts. Please check your connection and try again.'
        } else if (error.message.includes('API error')) {
            errorMessage = 'Service error: ' + error.message.split('API error: ')[1]
        }

        addMessageToUI('assistant', errorMessage, true)

        // Restore the user's message in the input field
        userInput.value = message
        autoResizeTextarea(userInput)

    } finally {
        userInput.disabled = false
        sendButton.disabled = false
        loadingIndicator.style.display = 'none'
        if (loadingIndicator.querySelector('span')) {
            loadingIndicator.querySelector('span').textContent = 'AI is thinking...'
        }
        if (!conversationState.completed) {
            userInput.focus()
        }
    }
}

// Clear conversation
function clearConversation() {
    if (conversationState.messages.length === 0) return

    if (!CLEAR_BUTTON_LABEL) return

    var confirmClear = confirm(CLEAR_WARNING_TEXT)

    if (confirmClear) {
        conversationState.messages = []
        conversationState.completed = false
        conversationData.value = ''
        setAnswer('')

        conversationState.initialized = false
        initializeConversation()
        updateButtonVisibility()

        if (userInput) {
            userInput.focus()
        }
    }
}

// Update button visibility
function updateButtonVisibility() {
    if (clearButton && CLEAR_BUTTON_LABEL) {
        clearButton.style.display = conversationState.messages.length > 0 ? 'block' : 'none'
    } else if (clearButton) {
        clearButton.style.display = 'none'
    }

    if (completeButton) {
        completeButton.style.display = (conversationState.messages.length > 0 && !conversationState.completed) ? 'block' : 'none'
    }
}

// Save conversation
function saveConversation() {
    var conversationString = JSON.stringify(conversationState.messages)
    conversationData.value = conversationString
    setAnswer(conversationString)
}

// Complete conversation
function completeConversation() {
    var confirmComplete = confirm(COMPLETE_WARNING_TEXT)

    if (confirmComplete) {
        conversationState.completed = true
        conversationState.messages.push({ role: 'system', content: '__CONVERSATION_COMPLETED__' })
        saveConversation()

        userInput.disabled = true
        sendButton.disabled = true
        completeButton.style.display = 'none'

        addMessageToUI('assistant', END_MESSAGE, true)
    }
}

// Clear answer (called by SurveyCTO)
function clearAnswer() {
    conversationState.messages = []
    conversationState.completed = false
    conversationData.value = ''
    conversationState.initialized = false

    if (suggestedPromptsContainer) {
        suggestedPromptsContainer.innerHTML = ''
        clearUnsentInput()
    }

    initializeConversation()
    updateButtonVisibility()
    isTimedOut = false
    stopActivityTimer()
    if (TIMEOUT_SECONDS > 0 && !fieldProperties.READONLY) {
        resetActivityTimer()
    }
}

// Set focus
function setFocus() {
    if (!fieldProperties.READONLY && userInput && !conversationState.completed) {
        userInput.focus()
        if (window.showSoftKeyboard) {
            window.showSoftKeyboard()
        }
    }
}

// Initialize suggested prompts
function initializeSuggestedPrompts() {
    if (!SUGGESTED_PROMPTS || fieldProperties.READONLY) return

    var prompts = SUGGESTED_PROMPTS.split('|').map(function (prompt) {
        return prompt.trim()
    }).filter(function (prompt) {
        return prompt.length > 0
    })

    if (prompts.length === 0) return

    prompts.forEach(function (prompt) {
        var button = document.createElement('button')
        button.textContent = prompt
        button.className = 'suggested-prompt-button'
        button.onclick = function () {
            if (!userInput.disabled && !conversationState.completed) {
                userInput.value = prompt
                autoResizeTextarea(userInput)
                sendMessage()
            }
        }
        suggestedPromptsContainer.appendChild(button)
    })
}

// Initialize buttons
function initializeButtons() {
    var clearButtonElement = document.getElementById('clear-button')
    var clearButtonText = document.getElementById('clear-button-text')
    var completeButtonElement = document.getElementById('complete-button')
    var completeButtonText = document.getElementById('complete-button-text')
    var sendButtonElement = document.getElementById('send-button')

    if (CLEAR_BUTTON_LABEL && clearButtonElement && clearButtonText) {
        clearButtonText.textContent = CLEAR_BUTTON_LABEL
    } else if (clearButtonElement) {
        clearButtonElement.style.display = 'none'
    }

    if (completeButtonElement && completeButtonText) {
        completeButtonText.textContent = COMPLETE_BUTTON_LABEL
    }

    if (sendButtonElement) {
        sendButtonElement.textContent = SEND_BUTTON_LABEL
    }
}

// Timeout handling functions
function saveUnsentInput() {
    if (userInput && userInput.value.trim()) {
        var storageKey = INPUT_SAVE_KEY + '_' + fieldName
        sessionStorage.setItem(storageKey, userInput.value)
    }
}

function restoreUnsentInput() {
    if (userInput) {
        var storageKey = INPUT_SAVE_KEY + '_' + fieldName
        var saved = sessionStorage.getItem(storageKey)
        if (saved) {
            userInput.value = saved
            autoResizeTextarea(userInput)
        }
    }
}

function clearUnsentInput() {
    var storageKey = INPUT_SAVE_KEY + '_' + fieldName
    sessionStorage.removeItem(storageKey)
}

function resetActivityTimer() {
    lastActivityTime = Date.now()

    if (isTimedOut || TIMEOUT_SECONDS <= 0 || userInput.disabled || conversationState.completed) {
        return
    }

    if (timeoutTimer) {
        clearTimeout(timeoutTimer)
        timeoutTimer = null
    }

    timeoutTimer = setTimeout(function () {
        handleTimeout()
    }, TIMEOUT_SECONDS * 1000)
}

function handleTimeout() {
    console.log('Interaction timed out after', TIMEOUT_SECONDS, 'seconds of inactivity')

    isTimedOut = true

    var timeoutMessage = `Session timed out after ${TIMEOUT_SECONDS} seconds of inactivity. Interaction has been locked.`
    addMessageToUI('assistant', timeoutMessage, true)

    userInput.disabled = true
    sendButton.disabled = true
    if (clearButton) clearButton.disabled = true
    if (completeButton) completeButton.style.display = 'none'

    userInput.placeholder = 'Session timed out - interaction locked'

    conversationState.messages.push({ role: 'system', content: '__SESSION_TIMEOUT__' })
    saveConversation()

    stopActivityTimer()
}

function stopActivityTimer() {
    if (timeoutTimer) {
        clearTimeout(timeoutTimer)
        timeoutTimer = null
    }
}

function checkIfTimedOut() {
    return conversationState.messages.some(function (msg) {
        return msg.content === '__SESSION_TIMEOUT__'
    })
}

function checkIfCompleted() {
    return conversationState.messages.some(function (msg) {
        return msg.content === '__CONVERSATION_COMPLETED__'
    })
}

// Main conversation initialization with enhanced error handling
async function initializeConversation() {
    if (conversationState.initialized) {
        return
    }

    try {

        var validationErrors = validateParameters()
        if (validationErrors.length > 0) {
            throw new Error('Missing required parameters: ' + validationErrors.join(', '))
        }

        if (loadingIndicator) {
            loadingIndicator.style.display = 'block'
            loadingIndicator.querySelector('span').textContent = 'Initializing conversation...'
        }

        initializeButtons()
        initializeSuggestedPrompts()
        initializeTextareaAutoResize()
        conversationDisplay.innerHTML = ''

        var hasSavedData = conversationData && conversationData.value
        var savedMessages = []

        if (hasSavedData) {
            try {
                savedMessages = JSON.parse(conversationData.value)
                conversationState.messages = savedMessages
            } catch (e) {
                console.error('Error parsing saved conversation:', e)
                savedMessages = []
                conversationState.messages = []
            }
        }

        if (savedMessages.length > 0) {
            // Display saved messages
            savedMessages.forEach(function (message) {
                addMessageToUI(message.role, message.content, false)
            })

            // Check if previously completed
            if (checkIfCompleted()) {
                conversationState.completed = true
                userInput.disabled = true
                sendButton.disabled = true
            }
        } else {
            // New conversation - generate initial response with streaming
            try {
                loadingIndicator.style.display = 'none'

                var streamingElements = addStreamingMessageToUI('assistant', '')

                var initialResponse = await generateInitialResponseWithStreaming(function (chunk, fullContent) {
                    updateStreamingMessage(streamingElements, chunk, fullContent)
                })

                finishStreamingMessage(streamingElements, initialResponse)

                // Check if initial response has special codes
                var specialCode = detectSpecialCodes(initialResponse)
                if (specialCode.detected) {
                    handleConversationEnd(specialCode)
                } else {
                    conversationState.messages.push({ role: 'assistant', content: initialResponse })
                    saveConversation()
                }
            } catch (error) {
                console.error('Error generating initial response:', error)

                // Clean up streaming UI if it exists
                if (streamingElements && streamingElements.messageDiv) {
                    streamingElements.messageDiv.remove()
                }

                // Provide user-friendly error message
                var errorMessage = 'Error starting conversation. Please check your connection and try again.'
                if (error.message.includes('timeout') || error.message.includes('Stream')) {
                    errorMessage = 'Connection timeout while starting conversation. Please try again.'
                } else if (error.message.includes('API error')) {
                    errorMessage = 'Service error: ' + error.message.split('API error: ')[1]
                } else if (error.message.includes('Failed after')) {
                    errorMessage = 'Unable to connect after multiple attempts. Please check your connection.'
                }

                addMessageToUI('assistant', errorMessage, true)
            }
        }

        // Check if session was previously timed out
        if (checkIfTimedOut()) {
            isTimedOut = true
            userInput.disabled = true
            sendButton.disabled = true
            if (clearButton) clearButton.disabled = true
            if (completeButton) completeButton.style.display = 'none'
            userInput.placeholder = 'Session timed out - interaction locked'
        } else if (!conversationState.completed) {
            // Start timeout timer for active sessions
            if (TIMEOUT_SECONDS > 0 && !fieldProperties.READONLY) {
                resetActivityTimer()
            }

            // Restore any unsent input from previous session
            restoreUnsentInput()
        }

        conversationState.initialized = true
        updateButtonVisibility()

    } catch (error) {
        console.error('Error during conversation initialization:', error)
        conversationDisplay.innerHTML = ''
        addMessageToUI('assistant', `Error initializing conversation: ${error.message}. Please check your parameters and try again.`, true)
        conversationState.initialized = true
    } finally {
        if (loadingIndicator) {
            loadingIndicator.style.display = 'none'
            if (loadingIndicator.querySelector('span')) {
                loadingIndicator.querySelector('span').textContent = 'AI is thinking...'
            }
        }
    }
}

// Event listeners
if (!fieldProperties.READONLY) {
    sendButton.addEventListener('click', sendMessage)

    if (clearButton) {
        clearButton.addEventListener('click', clearConversation)
    }

    if (completeButton) {
        completeButton.addEventListener('click', completeConversation)
    }

    userInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
        // Shift+Enter will create a new line (default behavior)
    })
}

if (!fieldProperties.READONLY && userInput) {
    userInput.addEventListener('input', function () {
        saveUnsentInput()
        autoResizeTextarea(this)
    })
    userInput.addEventListener('blur', saveUnsentInput)
    userInput.addEventListener('keyup', saveUnsentInput)
}

// Timeout functionality - track user activity
if (TIMEOUT_SECONDS > 0 && !fieldProperties.READONLY) {

    userInput.addEventListener('input', resetActivityTimer)
    userInput.addEventListener('keypress', resetActivityTimer)
    userInput.addEventListener('keydown', resetActivityTimer)
    userInput.addEventListener('focus', resetActivityTimer)

    sendButton.addEventListener('click', resetActivityTimer)
    if (clearButton) {
        clearButton.addEventListener('click', resetActivityTimer)
    }
    if (completeButton) {
        completeButton.addEventListener('click', resetActivityTimer)
    }

    if (suggestedPromptsContainer) {
        suggestedPromptsContainer.addEventListener('click', resetActivityTimer)
    }
}

// Handle page visibility changes for timeout
if (TIMEOUT_SECONDS > 0) {
    document.addEventListener('visibilitychange', function () {
        if (isTimedOut || conversationState.completed) {
            return
        }

        if (document.hidden) {
            stopActivityTimer()
        } else {
            var timeSinceLastActivity = Date.now() - lastActivityTime
            var remainingTime = (TIMEOUT_SECONDS * 1000) - timeSinceLastActivity

            if (remainingTime <= 0) {
                handleTimeout()
            } else {
                timeoutTimer = setTimeout(function () {
                    handleTimeout()
                }, remainingTime)
            }
        }
    })
}

window.addEventListener('beforeunload', function () {
    if (userInput && userInput.value.trim()) {
        saveUnsentInput()
    }
})

// Start conversation initialization
initializeConversation()

// End of script
