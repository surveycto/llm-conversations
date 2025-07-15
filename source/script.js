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

// Send message to OpenAI
async function sendToOpenAI(messages) {
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
            temperature: 0.7
        })
    })
    
    if (!response.ok) {
        var errorData = await response.json()
        throw new Error('OpenAI API error: ' + (errorData.error?.message || response.statusText))
    }
    
    var data = await response.json()
    return data.choices[0].message.content
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

// Generate AI response
async function generateResponse(userMessage) {
    var completeSystemPrompt = buildCompleteSystemPrompt()
    
    var messages = [
        { role: 'system', content: completeSystemPrompt },
        ...conversationState.messages,
        { role: 'user', content: userMessage }
    ]
    
    var aiResponse = await sendToOpenAI(messages)
    return aiResponse
}

// Generate initial response
async function generateInitialResponse() {
    var completeSystemPrompt = buildCompleteSystemPrompt()
    
    var messages = [
        { role: 'system', content: completeSystemPrompt },
        { role: 'user', content: CONVERSATION_STARTER }
    ]
    
    var aiResponse = await sendToOpenAI(messages)
    return aiResponse
}

// Add message to UI
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

// Handle sending a message
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
        
        var aiResponse = await generateResponse(message)
        
        // Check for special codes
        var specialCode = detectSpecialCodes(aiResponse)
        if (specialCode.detected) {
            handleConversationEnd(specialCode)
        } else {
            conversationState.messages.push({ role: 'assistant', content: aiResponse })
            addMessageToUI('assistant', aiResponse, true)
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
    return conversationState.messages.some(msg => msg.content === '__SESSION_TIMEOUT__')
}

function checkIfCompleted() {
    return conversationState.messages.some(msg => msg.content === '__CONVERSATION_COMPLETED__')
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
            // New conversation - generate initial response from LLM
            try {
                console.log('Generating initial response with conversation starter:', CONVERSATION_STARTER)
                var initialResponse = await generateInitialResponse()
                
                // Check if initial response has special codes
                var specialCode = detectSpecialCodes(initialResponse)
                if (specialCode.detected) {
                    handleConversationEnd(specialCode)
                } else {
                    conversationState.messages.push({ role: 'assistant', content: initialResponse })
                    addMessageToUI('assistant', initialResponse, true)
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
    })
}

if (!fieldProperties.READONLY && userInput) {
    userInput.addEventListener('input', saveUnsentInput)
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
