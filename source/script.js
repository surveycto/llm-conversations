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
var OPENAI_MODEL = getPluginParameter('model') || 'gpt-4o-mini'
var OPENAI_API_KEY = getPluginParameter('api-key') || ''
var CLEAR_BUTTON_LABEL = getPluginParameter('clear-button-label') || ''
var COMPLETE_BUTTON_LABEL = getPluginParameter('complete-button-label') || '✓'
var CLEAR_WARNING_TEXT = getPluginParameter('clear-warning-text') || 'Are you sure you want to clear the entire conversation? This action cannot be undone.'
var COMPLETE_WARNING_TEXT = getPluginParameter('complete-warning-text') || 'Are you sure you want to complete this conversation? You will not be able to add more messages.'
var SUGGESTED_PROMPTS = getPluginParameter('suggested-prompts') || ''
var END_MESSAGE = getPluginParameter('end-message') || 'Thank you for your participation.'
var CONVERSATION_STARTER = getPluginParameter('conversation-starter') || 'Please begin the conversation as instructed.'

// Conversation state
var conversationState = {
    messages: [],
    initialized: false,
    completed: false
}

var INPUT_SAVE_KEY = 'chatbot_unsent_input'
var fieldName = fieldProperties.FIELD_NAME || 'chatbot_field'
var TIMEOUT_SECONDS = getPluginParameter('timeout') || 600
var timeoutTimer = null
var lastActivityTime = Date.now()
var isTimedOut = false

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
    
    if (!OPENAI_API_KEY) {
        errors.push('OpenAI API key is required')
    }
    if (!SYSTEM_PROMPT) {
        errors.push('System prompt is required')
    }
    
    return errors
}

// Handle HTML entities in labels and hints
function unEntity(str) {
    return str.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
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
        userInput.addEventListener('input', function() {
            autoResizeTextarea(this)
        })
        
        userInput.addEventListener('paste', function() {
            // Delay to allow paste content to be processed
            setTimeout(function() {
                autoResizeTextarea(userInput)
            }, 0)
        })
    }
}

// Send message to OpenAI with streaming support
async function sendToOpenAI(messages, onStreamChunk) {
    if (!OPENAI_API_KEY) {
        throw new Error('OpenAI API key not provided')
    }
    
    var response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + OPENAI_API_KEY
        },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: messages,
            max_tokens: 1000,
            temperature: 0.7,
            stream: true
        })
    })
    
    if (!response.ok) {
        var errorData = await response.json()
        throw new Error('OpenAI API error: ' + (errorData.error?.message || response.statusText))
    }
    
    var reader = response.body.getReader()
    var decoder = new TextDecoder()
    var fullResponse = ''
    
    try {
        while (true) {
            var { done, value } = await reader.read()
            if (done) break
            
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
    
    return fullResponse
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
    
    // Update content
    contentDiv.textContent = fullContent
    
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
    
    // Set final content
    contentDiv.textContent = finalContent
    
    // Final scroll
    conversationDisplay.scrollTop = conversationDisplay.scrollHeight
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
    console.log('Conversation ending with code:', specialCode.code)
    
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
    
    return await sendToOpenAI(messages, onStreamChunk)
}

// Generate initial response with streaming
async function generateInitialResponseWithStreaming(onStreamChunk) {
    var completeSystemPrompt = buildCompleteSystemPrompt()
    
    var messages = [
        { role: 'system', content: completeSystemPrompt },
        { role: 'user', content: CONVERSATION_STARTER }
    ]
    
    return await sendToOpenAI(messages, onStreamChunk)
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
    contentDiv.textContent = content
    
    messageDiv.appendChild(contentDiv)
    conversationDisplay.appendChild(messageDiv)
    
    if (animate) {
        contentDiv.style.opacity = '0'
        contentDiv.style.transform = 'translateY(10px)'
        setTimeout(function() {
            contentDiv.style.transition = 'opacity 0.3s, transform 0.3s'
            contentDiv.style.opacity = '1'
            contentDiv.style.transform = 'translateY(0)'
        }, 10)
    }
    
    conversationDisplay.scrollTop = conversationDisplay.scrollHeight
}

// Handle sending a message with streaming
async function sendMessage() {
    var message = userInput.value.trim()

    if (isTimedOut || conversationState.completed) {
        console.log('Message blocked - session timed out or completed')
        return
    }

    if (!message) return
    
    userInput.disabled = true
    sendButton.disabled = true
    loadingIndicator.style.display = 'block'
    
    try {
        conversationState.messages.push({ role: 'user', content: message })
        addMessageToUI('user', message, true)
        userInput.value = ''
        autoResizeTextarea(userInput) // Reset textarea height
        
        // Hide loading indicator for streaming
        loadingIndicator.style.display = 'none'
        
        // Create streaming message UI
        var streamingElements = addStreamingMessageToUI('assistant', '')
        
        // Generate response with streaming
        var fullResponse = await generateResponseWithStreaming(message, function(chunk, fullContent) {
            updateStreamingMessage(streamingElements, chunk, fullContent)
        })
        
        // Finish streaming
        finishStreamingMessage(streamingElements, fullResponse)
        
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
        var errorMessage = 'Sorry, I encountered an error: ' + error.message
        addMessageToUI('assistant', errorMessage, true)
    } finally {
        userInput.disabled = false
        sendButton.disabled = false
        loadingIndicator.style.display = 'none'
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
    
    var prompts = SUGGESTED_PROMPTS.split('|').map(function(prompt) {
        return prompt.trim()
    }).filter(function(prompt) {
        return prompt.length > 0
    })
    
    if (prompts.length === 0) return
    
    prompts.forEach(function(prompt) {
        var button = document.createElement('button')
        button.textContent = prompt
        button.className = 'suggested-prompt-button'
        button.onclick = function() {
            if (!userInput.disabled && !conversationState.completed) {
                userInput.value = prompt
                autoResizeTextarea(userInput)
                sendMessage()
            }
        }
        suggestedPromptsContainer.appendChild(button)
    })
    
    console.log('Initialized', prompts.length, 'suggested prompts')
}

// Initialize buttons
function initializeButtons() {
    var clearButtonElement = document.getElementById('clear-button')
    var clearButtonText = document.getElementById('clear-button-text')
    var completeButtonElement = document.getElementById('complete-button')
    var completeButtonText = document.getElementById('complete-button-text')
    
    if (CLEAR_BUTTON_LABEL && clearButtonElement && clearButtonText) {
        clearButtonText.textContent = CLEAR_BUTTON_LABEL
    } else if (clearButtonElement) {
        clearButtonElement.style.display = 'none'
    }
    
    if (completeButtonElement && completeButtonText) {
        completeButtonText.textContent = COMPLETE_BUTTON_LABEL
    }
}

// Timeout handling functions
function saveUnsentInput() {
    if (userInput && userInput.value.trim()) {
        var storageKey = INPUT_SAVE_KEY + '_' + fieldName
        sessionStorage.setItem(storageKey, userInput.value)
        console.log('Saved unsent input:', userInput.value.length, 'characters')
    }
}

function restoreUnsentInput() {
    if (userInput) {
        var storageKey = INPUT_SAVE_KEY + '_' + fieldName
        var saved = sessionStorage.getItem(storageKey)
        if (saved) {
            userInput.value = saved
            autoResizeTextarea(userInput)
            console.log('Restored unsent input:', saved.length, 'characters')
        }
    }
}

function clearUnsentInput() {
    var storageKey = INPUT_SAVE_KEY + '_' + fieldName
    sessionStorage.removeItem(storageKey)
    console.log('Cleared unsent input from storage')
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
    
    timeoutTimer = setTimeout(function() {
        handleTimeout()
    }, TIMEOUT_SECONDS * 1000)
    
    console.log('Activity timer reset. Timeout in', TIMEOUT_SECONDS, 'seconds')
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
        console.log('Activity timer stopped')
    }
}

function checkIfTimedOut() {
    return conversationState.messages.some(function(msg) {
        return msg.content === '__SESSION_TIMEOUT__'
    })
}

function checkIfCompleted() {
    return conversationState.messages.some(function(msg) {
        return msg.content === '__CONVERSATION_COMPLETED__'
    })
}

// Main conversation initialization
async function initializeConversation() {
    if (conversationState.initialized) {
        console.log('Conversation already initialized, skipping...')
        return
    }
    
    try {
        console.log('Initializing conversation...')
        console.log('System prompt length:', SYSTEM_PROMPT.length)
        console.log('Case data length:', CASE_DATA.length)
        
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
                console.log('Loaded saved conversation with', savedMessages.length, 'messages')
            } catch (e) {
                console.error('Error parsing saved conversation:', e)
                savedMessages = []
                conversationState.messages = []
            }
        }
        
        if (savedMessages.length > 0) {
            // Display saved messages
            savedMessages.forEach(function(message) {
                addMessageToUI(message.role, message.content, false)
            })
            
            // Check if previously completed
            if (checkIfCompleted()) {
                conversationState.completed = true
                userInput.disabled = true
                sendButton.disabled = true
                console.log('Conversation was previously completed')
            }
        } else {
            // New conversation - generate initial response with streaming
            try {
                console.log('Generating initial response with streaming...')
                loadingIndicator.style.display = 'none'
                
                var streamingElements = addStreamingMessageToUI('assistant', '')
                
                                var initialResponse = await generateInitialResponseWithStreaming(function(chunk, fullContent) {
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
                addMessageToUI('assistant', 'Error starting conversation: ' + error.message, true)
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
            console.log('Session was previously timed out, keeping controls disabled')
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
        console.log('Conversation initialization complete')
        
    } catch (error) {
        console.error('Error during conversation initialization:', error)
        conversationDisplay.innerHTML = ''
        addMessageToUI('assistant', `Error initializing conversation: ${error.message}. Please check your parameters and try again.`, true)
        conversationState.initialized = true
    } finally {
        if (loadingIndicator) {
            loadingIndicator.style.display = 'none'
            loadingIndicator.querySelector('span').textContent = 'AI is thinking...'
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
    
    userInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
        // Shift+Enter will create a new line (default behavior)
    })
}

if (!fieldProperties.READONLY && userInput) {
    userInput.addEventListener('input', function() {
        saveUnsentInput()
        autoResizeTextarea(this)
    })
    userInput.addEventListener('blur', saveUnsentInput)
    userInput.addEventListener('keyup', saveUnsentInput)
}

// Timeout functionality - track user activity
if (TIMEOUT_SECONDS > 0 && !fieldProperties.READONLY) {
    console.log('Timeout functionality enabled:', TIMEOUT_SECONDS, 'seconds')
    
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
    document.addEventListener('visibilitychange', function() {
        if (isTimedOut || conversationState.completed) {
            return
        }
        
        if (document.hidden) {
            console.log('Page hidden, stopping activity timer')
            stopActivityTimer()
        } else {
            console.log('Page visible, restarting activity timer')
            var timeSinceLastActivity = Date.now() - lastActivityTime
            var remainingTime = (TIMEOUT_SECONDS * 1000) - timeSinceLastActivity
            
            if (remainingTime <= 0) {
                handleTimeout()
            } else {
                timeoutTimer = setTimeout(function() {
                    handleTimeout()
                }, remainingTime)
            }
        }
    })
}

window.addEventListener('beforeunload', function() {
    if (userInput && userInput.value.trim()) {
        saveUnsentInput()
    }
})

// Start conversation initialization
console.log('Script loaded, starting initialization...')
initializeConversation()

