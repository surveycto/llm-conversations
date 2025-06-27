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

// Conversation state
var conversation = []
var languageEstablished = false // Track if user has established language preference

// OpenAI configuration
var OPENAI_API_KEY = getPluginParameter('api-key') || ''
var OPENAI_MODEL = getPluginParameter('model') || 'gpt-3.5-turbo'
var CHAT_LANGUAGE = getPluginParameter('language') || 'English'

// Create system message for proper language flow
var SYSTEM_MESSAGE = getPluginParameter('system-message') || createLanguageFlowSystemMessage()

function createLanguageFlowSystemMessage() {
    var baseMessage = `You are a helpful assistant. Here's how to handle language preferences:

1. INITIAL LANGUAGE DETECTION: If this is the start of the conversation and the user hasn't clearly established a language preference yet, you should detect what language they want to use based on their first message.

2. LANGUAGE PREFERENCE RESPONSES: 
   - If the user asks for a specific language (e.g., "Spanish please", "En français", "Deutsch"), acknowledge their request and switch to that language immediately.
   - If the user asks a question without specifying language, use English by default.
   - If the user writes in a non-English language, respond in that same language.

3. LANGUAGE SWITCHING: If at any point the user requests a different language, acknowledge the request and switch immediately.

4. FORM HINT: The form suggests ${CHAT_LANGUAGE} as a preferred language, but the user's actual request takes priority.

5. DEFAULT BEHAVIOR: If no specific language is requested, use English.

Remember to be natural and conversational while handling these language preferences.`

    return baseMessage
}

// Initialize suggested prompts from parameters
var SUGGESTED_PROMPTS = getPluginParameter('prompts') || ''
if (SUGGESTED_PROMPTS) {
    var prompts = SUGGESTED_PROMPTS.split('|')
    prompts.forEach(function(prompt) {
        var button = document.createElement('button')
        button.textContent = prompt
        button.onclick = function() { 
            userInput.value = prompt
            sendMessage()
        }
        suggestedPromptsContainer.appendChild(button)
    })
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

// Function to get the initial welcome message that asks about language preference
function getWelcomeMessage() {
    if (CHAT_LANGUAGE && CHAT_LANGUAGE !== 'English') {
        return `Hello! I'm your AI assistant. I can communicate in many languages. I see you may prefer ${CHAT_LANGUAGE} - would you like to continue in ${CHAT_LANGUAGE}, or would you prefer a different language? Just let me know your preference and how I can help you today.`
    }
    return "Hello! I'm your AI assistant. I can communicate in many languages. What language would you prefer for our conversation? You can tell me in English or your preferred language (e.g., 'English please', 'Español por favor', 'Français s'il vous plaît'). If you'd like to continue in English, just let me know how I can help you."
}

// Function to immediately show the dynamic welcome message
function showDynamicWelcomeMessage() {
    try {
        console.log('Generating dynamic welcome message...')
        var welcomeMessage = getWelcomeMessage()
        console.log('Welcome message:', welcomeMessage)
        
        var welcomeHTML = '<div class="welcome-message"><div class="message bot-message"><div class="message-content">' + 
                         welcomeMessage + '</div></div></div>'
        
        conversationDisplay.innerHTML = welcomeHTML
        console.log('Dynamic welcome message displayed')
        
        // Ensure conversation array is empty for new conversation
        conversation = []
        languageEstablished = false
        
    } catch (error) {
        console.error('Error showing welcome message:', error)
        // Last resort fallback
        conversationDisplay.innerHTML = '<div class="welcome-message"><div class="message bot-message"><div class="message-content">Hello! I\'m your AI assistant. How can I help you today?</div></div></div>'
    }
}

// Update clear button visibility based on conversation state
function updateClearButtonVisibility() {
    if (clearButton) {
        if (conversation.length > 0) {
            clearButton.style.display = 'block'
        } else {
            clearButton.style.display = 'none'
        }
    }

    if (completeButton) {
        if (conversation.length > 0) {
            completeButton.style.display = 'block'
        } else {
            completeButton.style.display = 'none'
        }
    }
}

// Enhanced renderConversation
function renderConversation() {
    try {
        console.log('Rendering conversation...')
        
        // Clear current display
        conversationDisplay.innerHTML = ''
        
        // Add welcome message if no conversation exists
        if (conversation.length === 0) {
            showDynamicWelcomeMessage()
            return
        }
        
        // Render all messages
        conversation.forEach(function(message, index) {
            console.log('Rendering message', index + 1, 'of', conversation.length)
            addMessageToUI(message.role, message.content, false)
        })
        
        // Scroll to bottom
        conversationDisplay.scrollTop = conversationDisplay.scrollHeight
        console.log('Conversation rendering complete')
    } catch (error) {
        console.error('Error rendering conversation:', error)
        showDynamicWelcomeMessage()
    }
}

// Add a message to the UI
function addMessageToUI(role, content, animate) {
    var messageDiv = document.createElement('div')
    messageDiv.className = 'message ' + (role === 'user' ? 'user-message' : 'bot-message')
    
    var contentDiv = document.createElement('div')
    contentDiv.className = 'message-content'
    contentDiv.textContent = content
    
    messageDiv.appendChild(contentDiv)
    conversationDisplay.appendChild(messageDiv)
    
    // Animate if requested
    if (animate) {
        contentDiv.style.opacity = '0'
        contentDiv.style.transform = 'translateY(10px)'
        setTimeout(function() {
            contentDiv.style.transition = 'opacity 0.3s, transform 0.3s'
            contentDiv.style.opacity = '1'
            contentDiv.style.transform = 'translateY(0)'
        }, 10)
    }
    
    // Scroll to bottom
    conversationDisplay.scrollTop = conversationDisplay.scrollHeight
}

// Send message to OpenAI
async function sendToOpenAI(messages) {
    if (!OPENAI_API_KEY) {
        throw new Error('OpenAI API key not provided. Please set the "api-key" parameter.')
    }
    
    // Prepare messages with system message
    var apiMessages = [
        { role: 'system', content: SYSTEM_MESSAGE },
        ...messages
    ]
    
    var response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + OPENAI_API_KEY
        },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: apiMessages,
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

// Handle sending a message
async function sendMessage() {
    var message = userInput.value.trim()
    if (!message) return
    
    // Disable input and show loading
    userInput.disabled = true
    sendButton.disabled = true
    if (clearButton) clearButton.disabled = true
    loadingIndicator.style.display = 'block'
    
    try {
        // Add user message to conversation
        conversation.push({ role: 'user', content: message })
        addMessageToUI('user', message, true)
        
        // Mark language as established after first user message
        if (!languageEstablished) {
            languageEstablished = true
        }
        
        // Clear input
        userInput.value = ''
        
        // Get AI response (LLM handles language detection and switching automatically)
        var aiResponse = await sendToOpenAI(conversation)
        
        // Add AI response to conversation
        conversation.push({ role: 'assistant', content: aiResponse })
        addMessageToUI('assistant', aiResponse, true)
        
        // Save conversation and update UI
        saveConversation()
        updateClearButtonVisibility()
        
    } catch (error) {
        console.error('Error sending message:', error)
        
        // Add error message to UI
        var errorMessage = 'Sorry, I encountered an error: ' + error.message
        conversation.push({ role: 'assistant', content: errorMessage })
        addMessageToUI('assistant', errorMessage, true)
        
        saveConversation()
        updateClearButtonVisibility()
    } finally {
        // Re-enable input
        userInput.disabled = false
        sendButton.disabled = false
        if (clearButton) clearButton.disabled = false
        loadingIndicator.style.display = 'none'
        userInput.focus()
    }
}

// Handle clearing the conversation
function clearConversation() {
    if (conversation.length === 0) return
    
    // Confirm before clearing
    var confirmClear = confirm('Are you sure you want to clear the entire conversation? This action cannot be undone.')
    
    if (confirmClear) {
        conversation = []
        languageEstablished = false // Reset language state
        conversationData.value = ''
        setAnswer('')
        
        // Show dynamic welcome message based on current language parameter
        showDynamicWelcomeMessage()
        
        // Update clear button visibility
        updateClearButtonVisibility()
        
        // Focus on input
        if (userInput) {
            userInput.focus()
        }
    }
}

// Save conversation to field answer
function saveConversation() {
    var conversationString = JSON.stringify(conversation)
    conversationData.value = conversationString
    setAnswer(conversationString)
}

// Clear conversation (called by SurveyCTO)
function clearAnswer() {
    conversation = []
    languageEstablished = false // Reset language state
    conversationData.value = ''
    
    // Show dynamic welcome message based on current language parameter
    showDynamicWelcomeMessage()
    
    // Update clear button visibility
    updateClearButtonVisibility()
}

// Set focus to input field
function setFocus() {
    if (!fieldProperties.READONLY && userInput) {
        userInput.focus()
        if (window.showSoftKeyboard) {
            window.showSoftKeyboard()
        }
    }
}

function completeConversation() {
    // Mark conversation as complete
    conversation.push({ role: 'system', content: '__CONVERSATION_COMPLETED__' })
    saveConversation()
    
    // Disable further input
    userInput.disabled = true
    sendButton.disabled = true
    completeButton.style.display = 'none'
}

// Enhanced initialization with guaranteed welcome message
function initializeConversation() {
    try {
        console.log('Initializing conversation...')
        console.log('Language parameter:', CHAT_LANGUAGE)
        
        if (conversationData && conversationData.value) {
            try {
                conversation = JSON.parse(conversationData.value)
                // If there's saved conversation, language has been established
                if (conversation.length > 0) {
                    languageEstablished = true
                    console.log('Loaded saved conversation:', conversation.length, 'messages')
                    renderConversation()
                } else {
                    console.log('Empty saved conversation, showing welcome message')
                    showDynamicWelcomeMessage()
                }
            } catch (e) {
                console.error('Error parsing saved conversation:', e)
                conversation = []
                languageEstablished = false
                showDynamicWelcomeMessage()
            }
        } else {
            console.log('No saved conversation, showing welcome message')
            showDynamicWelcomeMessage()
        }
        
        updateClearButtonVisibility()
        console.log('Conversation initialization complete')
    } catch (error) {
        console.error('Error during initialization:', error)
        // Ensure welcome message shows even if there's an error
        showDynamicWelcomeMessage()
    }
}

// Immediate initialization function
function initializeFieldPlugin() {
    console.log('Field plugin initializing...')
    
    // Ensure all DOM elements are available
    if (!conversationDisplay || !userInput || !sendButton) {
        console.log('DOM elements not ready, retrying...')
        setTimeout(initializeFieldPlugin, 10)
        return
    }
    
    console.log('DOM elements ready, proceeding with initialization')
    initializeConversation()
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

// Start initialization immediately
console.log('Script loaded, starting initialization...')

// Try multiple initialization methods to ensure it works
initializeFieldPlugin()

// Backup initialization on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        console.log('DOM content loaded, backup initialization...')
        setTimeout(initializeFieldPlugin, 50)
    })
} else {
    console.log('DOM already ready, immediate backup initialization...')
    setTimeout(initializeFieldPlugin, 10)
}

// Final backup after page load
window.addEventListener('load', function() {
    console.log('Window loaded, final backup initialization...')
    setTimeout(function() {
        if (!conversationDisplay.innerHTML.trim()) {
            console.log('No content detected, forcing welcome message...')
            showDynamicWelcomeMessage()
        }
    }, 100)
})
