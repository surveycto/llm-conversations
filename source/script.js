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
var INTERVIEW_OUTLINE = getPluginParameter('outline') || ''
var SELECTED_CASE = getPluginParameter('selected_case') || ''
var SYSTEM_PROMPT_BASE = getPluginParameter('system_prompt') || ''
var MEDICAL_CASES = getPluginParameter('medical_cases') || ''
var OPENAI_MODEL = getPluginParameter('model') || 'gpt-4.1-mini-2025-04-14'
var OPENAI_API_KEY = getPluginParameter('api-key') || ''
var CLEAR_BUTTON_LABEL = getPluginParameter('clear-button-label') || '' // If empty, button is hidden
var COMPLETE_BUTTON_LABEL = getPluginParameter('complete-button-label') || '✓' // Default checkmark
var CLEAR_WARNING_TEXT = getPluginParameter('clear-warning-text') || 'Are you sure you want to clear the entire conversation? This action cannot be undone.'
var COMPLETE_WARNING_TEXT = getPluginParameter('complete-warning-text') || 'Are you sure you want to complete this conversation? You will not be able to add more messages.'

// Interview state
var interviewState = {
    stage: 'initial',
    messages: [],
    caseData: null,
    completeSystemPrompt: '',
    initialized: false  // Add flag to prevent double initialization
}

// Validate required parameters
function validateParameters() {
    var errors = []
    
    if (!OPENAI_API_KEY) {
        errors.push('API key is required')
    }
    if (!MEDICAL_CASES) {
        errors.push('Medical cases data is required')
    }
    if (!INTERVIEW_OUTLINE) {
        errors.push('Interview outline is required')
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

// Load case data directly from parameter
function loadCaseFromParameter() {
    try {
        console.log('Loading case from medical_cases parameter')
        
        if (!MEDICAL_CASES) {
            throw new Error('No medical cases data provided in parameter')
        }
        
        conversationDisplay.innerHTML = welcomeHTML
        // The medical_cases parameter contains the complete case narrative
        var caseData = {
            case_type: SELECTED_CASE || 'Medical Case',
            case_narrative: MEDICAL_CASES
        }
        
        console.log('Case data loaded successfully:', caseData.case_type)
        return caseData
        
    } catch (error) {
        console.error('Error loading case from parameter:', error)
        throw error
    }
}

// Build complete system prompt combining all components
function buildCompleteSystemPrompt(systemPromptBase, outline, caseNarrative) {
    var completePrompt = `${systemPromptBase}

${outline}

### MEDICAL CASE TO SIMULATE:

${caseNarrative}

### FINAL INSTRUCTIONS:
You must now embody this patient completely. Use the case narrative above to respond accurately to all provider questions. Follow the interview workflow outlined above, and use the structured Q&A responses when available.`

    return completePrompt
}

// Extract basic patient info from narrative for introduction
function extractPatientInfo(narrative) {
    var nameMatch = narrative.match(/(\w+) is a (\d+)-year-old (woman|man)/i)
    
    // Look for opening statement more carefully
    var openingMatch = narrative.match(/Opening [Ss]tatement:\s*(.+?)(?:\n|$)/i)
    if (!openingMatch) {
        // Alternative patterns for opening statement
        openingMatch = narrative.match(/Opening [Ss]tatement[:\s]*(.+?)(?:\n|\[|Provider Questions)/i)
    }
    
    return {
        name: nameMatch ? nameMatch[1] : 'Patient',
        age: nameMatch ? nameMatch[2] : 'unknown',
        gender: nameMatch ? nameMatch[3] : 'patient',
        openingStatement: openingMatch ? openingMatch[1].trim() : 'I need medical help.'
    }
}

// Send message to OpenAI with complete system prompt
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

// Generate patient response using complete system prompt
async function generatePatientResponse(providerQuestion) {
    var messages = [
        { role: 'system', content: interviewState.completeSystemPrompt },
        ...interviewState.messages,
        { role: 'user', content: providerQuestion }
    ]
    
    return await sendToOpenAI(messages)
}

// Add message to UI with header-style labels
function addMessageToUI(role, content, animate) {
    var messageDiv = document.createElement('div')
    var messageClass = 'message '
    
    if (role === 'system') {
        messageClass += 'system-message'
    } else if (role === 'user') {
        messageClass += 'user-message'
    } else {
        messageClass += 'bot-message'
    }
    
    messageDiv.className = messageClass
    
    // Add message header with speaker label
    var headerDiv = document.createElement('div')
    headerDiv.className = 'message-header'
    
    if (role === 'user') {
        headerDiv.textContent = 'Provider:'
    } else if (role === 'system') {
        headerDiv.textContent = 'System:'
    } else {
        // For assistant messages, determine if it's nurse or patient
        var patientName = 'Patient'
        if (interviewState.caseData) {
            var extractedInfo = extractPatientInfo(interviewState.caseData.case_narrative)
            patientName = extractedInfo.name
        }
        
        // Check if this looks like a nurse introduction or test result
        if (content.includes('Hello Doctor') || 
            content.includes('nurse performs') || 
            content.includes('A nurse performs') ||
            content.includes('test result') ||
            content.includes('rapid test') ||
            content.includes('The result is') ||
            content.includes('blood pressure') ||
            content.includes('temperature') ||
            content.includes('pulse')) {
            headerDiv.textContent = 'Nurse:'
        } else {
            headerDiv.textContent = patientName + ':'
        }
    }
    
    var contentDiv = document.createElement('div')
    contentDiv.className = 'message-content'
    contentDiv.textContent = content
    
    messageDiv.appendChild(headerDiv)
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
    if (!message) return
    
    userInput.disabled = true
    sendButton.disabled = true
    loadingIndicator.style.display = 'block'
    
    try {
        // Add user message
        interviewState.messages.push({ role: 'user', content: message })
        addMessageToUI('user', message, true)
        userInput.value = ''
        
        // Generate AI response
        var aiResponse = await generatePatientResponse(message)
        
        // Check for end codes
        if (aiResponse.includes('5j3k') || aiResponse.includes('x7y8')) {
            handleInterviewEnd(aiResponse)
        } else {
            interviewState.messages.push({ role: 'assistant', content: aiResponse })
            addMessageToUI('assistant', aiResponse, true)
        }
        
        saveConversation()
        updateClearButtonVisibility()
        
    } catch (error) {
        console.error('Error sending message:', error)
        var errorMessage = 'Sorry, I encountered an error: ' + error.message
        addMessageToUI('assistant', errorMessage, true)
    } finally {
        userInput.disabled = false
        sendButton.disabled = false
        loadingIndicator.style.display = 'none'
        userInput.focus()
    }
}

// Handle interview end
function handleInterviewEnd(response) {
    console.log('Interview ending with response:', response)
    
    var cleanResponse = response.replace(/5j3k|x7y8/g, '').trim()
    
    if (cleanResponse) {
        addMessageToUI('assistant', cleanResponse, true)
    }
    
    addMessageToUI('system', 'Thank you for participating, the interview concludes here.', true)
    
    userInput.disabled = true
    sendButton.disabled = true
    if (clearButton) clearButton.disabled = true
    if (completeButton) completeButton.style.display = 'none'
    
    interviewState.stage = 'complete'
    saveConversation()
}

// Clear conversation
function clearConversation() {
    if (interviewState.messages.length === 0) return
    
    var confirmClear = confirm('Are you sure you want to clear the entire conversation? This action cannot be undone.')
    
    if (confirmClear) {
        interviewState.messages = []
        conversationData.value = ''
        setAnswer('')
        
        // Reset initialization flag and reinitialize
        interviewState.initialized = false
        initializeConversation()
        updateClearButtonVisibility()
        
        if (userInput) {
            userInput.focus()
        }
    }
}

// Update button visibility
function updateClearButtonVisibility() {
    if (clearButton) {
        clearButton.style.display = interviewState.messages.length > 0 ? 'block' : 'none'
    }
    if (completeButton) {
        completeButton.style.display = interviewState.messages.length > 0 ? 'block' : 'none'
    }
}

// Save conversation
function saveConversation() {
    var conversationString = JSON.stringify(interviewState.messages)
    conversationData.value = conversationString
    setAnswer(conversationString)
}

// Complete conversation
function completeConversation() {
    interviewState.messages.push({ role: 'system', content: '__CONVERSATION_COMPLETED__' })
    saveConversation()
    
    userInput.disabled = true
    sendButton.disabled = true
    completeButton.style.display = 'none'
}

// Clear answer (called by SurveyCTO)
function clearAnswer() {
    interviewState.messages = []
    conversationData.value = ''
    interviewState.initialized = false
    initializeConversation()
    updateClearButtonVisibility()
}

// Set focus
function setFocus() {
    if (!fieldProperties.READONLY && userInput) {
        userInput.focus()
        if (window.showSoftKeyboard) {
            window.showSoftKeyboard()
        }
    }
}

// Setup case data without showing any messages
function setupCaseData() {
    console.log('Setting up case data...')
    
    // Validate required parameters
    var validationErrors = validateParameters()
    if (validationErrors.length > 0) {
        throw new Error('Missing required parameters: ' + validationErrors.join(', '))
    }
    
    // Load case data from parameter
    var caseData = loadCaseFromParameter()
    interviewState.caseData = caseData
    
    // Build complete system prompt
    interviewState.completeSystemPrompt = buildCompleteSystemPrompt(
        SYSTEM_PROMPT_BASE,
        INTERVIEW_OUTLINE,
        caseData.case_narrative
    )
    
    interviewState.stage = 'initial'
    console.log('Case data setup complete')
}

// Show the initial nurse and patient messages
function showInitialMessages() {
    if (!interviewState.caseData) return
    
    var patientInfo = extractPatientInfo(interviewState.caseData.case_narrative)
    
    // Show nurse introduction
    var nurseIntro = `Hello Doctor, I have a ${patientInfo.gender} patient named ${patientInfo.name} here. Would you like to conduct the consultation in English, or would you prefer another language? Also, please let me know if you would like me to perform any rapid tests or clinical examinations during your evaluation. Please indicate when you are done with your questions and exams, then you can provide your diagnosis or treatment plan.`
    
    addMessageToUI('assistant', nurseIntro, false)
    
    // Show patient opening statement
    addMessageToUI('assistant', patientInfo.openingStatement, false)
}

// Main initialization function - only runs once
function initializeConversation() {
    // Prevent double initialization
    if (interviewState.initialized) {
        console.log('Already initialized, skipping...')
        return
    }
    
    try {
        console.log('Initializing conversation...')
        
        // Setup case data first
        setupCaseData()
        
        // Clear display
        conversationDisplay.innerHTML = ''
        
        // Check if we have saved conversation data
        var hasSavedData = conversationData && conversationData.value
        var savedMessages = []
        
        if (hasSavedData) {
            try {
                savedMessages = JSON.parse(conversationData.value)
                interviewState.messages = savedMessages
                console.log('Loaded saved conversation with', savedMessages.length, 'messages')
            } catch (e) {
                console.error('Error parsing saved conversation:', e)
                savedMessages = []
                interviewState.messages = []
            }
        }
        
        // Always show initial messages first
        showInitialMessages()
        
        // Then add any saved messages
        if (savedMessages.length > 0) {
            savedMessages.forEach(function(message) {
                addMessageToUI(message.role, message.content, false)
            })
        }
        
        // Mark as initialized
        interviewState.initialized = true
        updateClearButtonVisibility()
        
        console.log('Conversation initialization complete')
        
    } catch (error) {
        console.error('Error during initialization:', error)
        conversationDisplay.innerHTML = ''
        addMessageToUI('assistant', `Error initializing simulation: ${error.message}. Please check your parameters and try again.`, true)
        interviewState.initialized = true // Mark as initialized even on error to prevent loops
    }
}

// Event listeners (only if not readonly)
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

// Start initialization - only once
console.log('Script loaded, starting initialization...')
initializeConversation()

// Remove the backup initialization methods to prevent multiple calls
// These were causing the duplicate messages
