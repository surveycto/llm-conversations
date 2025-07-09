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
var CASE_DATA = getPluginParameter('case_data') || getPluginParameter('medical_cases') || ''
var OPENAI_MODEL = getPluginParameter('model') || 'gpt-4o-mini'
var OPENAI_API_KEY = getPluginParameter('api-key') || ''
var CHAT_LANGUAGE = getPluginParameter('language') || '' 
var CLEAR_BUTTON_LABEL = getPluginParameter('clear-button-label') || ''
var COMPLETE_BUTTON_LABEL = getPluginParameter('complete-button-label') || '✓'
var CLEAR_WARNING_TEXT = getPluginParameter('clear-warning-text') || 'Are you sure you want to clear the entire medical interview? This action cannot be undone.'
var COMPLETE_WARNING_TEXT = getPluginParameter('complete-warning-text') || 'Are you sure you want to complete this medical consultation? You will not be able to add more messages.'
var SUGGESTED_PROMPTS = getPluginParameter('suggested-prompts') || ''
var END_MESSAGE = getPluginParameter('end-message') || 'Thank you for participating in this medical simulation.'

// Medical interview state
var medicalState = {
    stage: 'initial',
    phase: 'history', // history, examination, diagnosis, treatment, complete
    messages: [],
    caseData: null,
    completeSystemPrompt: '',
    initialized: false,
    treatmentCount: 0,   
    autoTransitionTriggered: false, 
    selectedLanguage: '', 
    awaitingLanguageSelection: false,
    patientInfo: null,
    nurseIntroduced: false
}

var INPUT_SAVE_KEY = 'chatbot_unsent_input'
var fieldName = fieldProperties.FIELD_NAME || 'chatbot_field'
var TIMEOUT_SECONDS = getPluginParameter('timeout') || 600
var timeoutTimer = null
var lastActivityTime = Date.now()
var isTimedOut = false

// Validate required parameters
function validateMedicalParameters() {
    var errors = []
    
    if (!OPENAI_API_KEY) {
        errors.push('OpenAI API key is required')
    }
    if (!CASE_DATA) {
        errors.push('Medical case data is required')
    }
    if (!SYSTEM_PROMPT_BASE) {
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

// Load medical case data from parameter
function loadMedicalCaseFromParameter() {
    try {
        console.log('Loading medical case from case_data parameter')
        
        if (!CASE_DATA) {
            throw new Error('No medical case data provided in parameter')
        }
        
        var caseData = {
            case_type: SELECTED_CASE || 'Medical Case',
            case_narrative: CASE_DATA
        }
        
        console.log('Medical case data loaded successfully:', caseData.case_type)
        return caseData
        
    } catch (error) {
        console.error('Error loading medical case from parameter:', error)
        throw error
    }
}

// Extract patient info from medical case
function extractPatientInfo(caseData) {
    var info = { name: null, age: null, gender: null, openingStatement: 'I need medical help.' }
    
    // Extract name, age, gender
    var nameMatch = caseData.match(/([A-Z][a-z]+) is a (\d+)(?:-year-old)?\s*(man|woman|male|female)/i)
    if (nameMatch) {
        info.name = nameMatch[1]
        info.age = nameMatch[2]
        info.gender = nameMatch[3]
    }
    
    // Extract opening statement
    var openingMatch = caseData.match(/Opening [Ss]tatement:\s*(.+?)(?:\n|$)/i)
    if (openingMatch) {
        info.openingStatement = openingMatch[1].trim()
    }
    
    return info
}

// Build medical system prompt
function buildMedicalSystemPrompt(systemPromptBase, outline, caseNarrative, language) {
    var languageInstruction = ''
    
    if (language && language.toLowerCase() !== 'english') {
        languageInstruction = `

### LANGUAGE REQUIREMENTS:
Conduct this ENTIRE medical consultation in ${language}. This includes:
- All patient responses and dialogue
- All nurse communications and test results  
- All system messages and transitions
- Maintain authentic medical terminology in ${language}
- If you don't know medical terms in ${language}, use simple descriptive language

Important: The provider (doctor) may write in English or ${language} - respond appropriately in ${language} regardless of the provider's language choice.`
    }

    // Extract medical Q&A section
    var qaSection = extractMedicalQASection(caseNarrative)
    var qaInstructions = ''
    
    if (qaSection) {
        qaInstructions = `

### STRUCTURED MEDICAL Q&A RESPONSES:
${qaSection}

### MEDICAL Q&A USAGE INSTRUCTIONS:
- PRIORITY: Use these specific Q&A responses when the provider's question matches or is similar to the questions listed above
- Match questions by meaning, not exact wording (e.g., "Do you have pain?" matches "Are you experiencing pain?")
- If no Q&A match exists, improvise based on the case narrative and medical background
- Always maintain patient character consistency with the case background
- Only reveal information that has been explicitly asked for by the provider`
    }

    // Build the complete prompt - conditionally include outline
    var completePrompt = systemPromptBase
    
    // Add outline only if it's provided and not empty
    if (outline && outline.trim().length > 0) {
        completePrompt += `

${outline}`
    }
    
    // Add language instruction if provided
    completePrompt += languageInstruction

    // Add the rest of the prompt
    completePrompt += `

### MEDICAL INTERVIEW PHASES:
This medical interview follows structured phases:
1. HISTORY TAKING - Answer specific questions about symptoms, timeline, medical history. Only provide information when directly asked.
2. PHYSICAL EXAMINATION - Allow examinations, provide test results through nurse using third-person clinical language
3. DIAGNOSIS - Listen to provider's diagnosis, then prompt for treatment using exact transition prompt
4. TREATMENT - Discuss treatment with confirmed diagnosis, then conclude with end codes

### MEDICAL CASE TO SIMULATE:

${caseNarrative}${qaInstructions}

### FINAL MEDICAL INSTRUCTIONS:
You must now embody this patient completely in a medical consultation. Use the case narrative above to respond accurately to all provider questions. Follow the medical interview workflow outlined above, and prioritize the structured Q&A responses when available for more accurate and consistent answers. Remember to conduct the consultation in ${language} and follow the appropriate medical phase behaviors. Use end codes 5j3k and x7y8 exactly as specified when completing the interview.`

    return completePrompt
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

// Translate text using OpenAI
async function translateText(text, targetLanguage) {
    if (!targetLanguage || targetLanguage.toLowerCase() === 'english') {
        return text
    }
    
    try {
        console.log(`Translating text to ${targetLanguage}...`)
        
        var translationMessages = [
            {
                role: 'system',
                content: `You are a professional medical translator. Translate the following text to ${targetLanguage}. Maintain medical accuracy and professional tone. Provide only the translation, no additional text or explanations.`
            },
            {
                role: 'user',
                content: text
            }
        ]
        
        var translatedText = await sendToOpenAI(translationMessages)
        console.log('Translation completed successfully')
        return translatedText.trim()
        
    } catch (error) {
        console.error('Translation failed:', error)
        return text
    }
}

// Medical phase instruction
function getMedicalPhaseInstruction(phase) {
    switch(phase) {
        case 'history':
            return '\n\nCurrent Phase: HISTORY TAKING - Answer questions about symptoms, timeline, medical history. Only provide information when directly asked. Do not volunteer additional details.'
        case 'examination':
            return '\n\nCurrent Phase: PHYSICAL EXAMINATION - Allow examinations, respond to test requests. Nurse can perform rapid tests and clinical examinations as requested.'
        case 'diagnosis':
            return '\n\nCurrent Phase: DIAGNOSIS - Wait for provider to give their preliminary diagnosis and treatment plan. Then prompt for the actual condition reveal.'
        case 'treatment':
            return '\n\nCurrent Phase: TREATMENT - Discuss treatment plan with confirmed diagnosis. Prepare to conclude the interview.'
        default:
            return ''
    }
}

// Detect medical phase transitions
function detectMedicalPhaseTransition(providerQuestion) {
    var question = providerQuestion.toLowerCase()
    var currentPhase = medicalState.phase
    
    // History → Examination transitions
    if (currentPhase === 'history' && isMedicalExaminationRequest(question)) {
        return 'examination'
    }
    
    // Examination/History → Diagnosis transitions  
    if ((currentPhase === 'examination' || currentPhase === 'history') && 
        (question.includes('my diagnosis') || 
         question.includes('i think you have') ||
         question.includes('preliminary diagnosis') ||
         question.includes('treatment plan') ||
         question.includes('i believe'))) {
        return 'diagnosis'
    }
    
    // Diagnosis → Treatment transitions
    if (currentPhase === 'diagnosis' && 
        (question.includes('how would you treat') ||
         question.includes('treatment') ||
         question.includes('medication') ||
         question.includes('therapy'))) {
        return 'treatment'
    }
    
    return currentPhase
}

// Check if request is medical examination
function isMedicalExaminationRequest(question) {
    var examKeywords = [
        'blood pressure', 'bp', 'temperature', 'temp', 'pulse', 'heart rate',
        'examine', 'auscult', 'listen to', 'palpate', 'feel for',
        'rapid test', 'blood test', 'urine test', 'x-ray', 'ultrasound',
        'clinical exam', 'physical exam', 'check your', 'breath sounds'
    ]
    
    return examKeywords.some(keyword => question.toLowerCase().includes(keyword))
}

// Generate medical examination result
async function generateMedicalExaminationResult(request) {
    console.log('Processing medical examination request:', request)
    
    var examResults = extractMedicalExamResults(medicalState.caseData.case_narrative, request)
    var nurseResponse = `A nurse performs ${request.toLowerCase()}. ${examResults}`
    
    if (CHAT_LANGUAGE && CHAT_LANGUAGE.toLowerCase() !== 'english') {
        nurseResponse = await translateText(nurseResponse, CHAT_LANGUAGE)
    }
    
    // Transition to examination phase if not already there
    if (medicalState.phase === 'history') {
        medicalState.phase = 'examination'
        addMessageToUI('system', 'Interview Phase: EXAMINATION', true, null)
    }
    
    return nurseResponse
}

// Extract medical exam results from case data
function extractMedicalExamResults(caseNarrative, request) {
    var requestLower = request.toLowerCase()
    var examSection = extractExamSection(caseNarrative)
    
    // Match specific exam requests to results
    if (requestLower.includes('blood pressure') || requestLower.includes('bp')) {
        var bpMatch = examSection.match(/(?:blood pressure|bp):\s*([^,\n]+)/i)
        return bpMatch ? bpMatch[1] : '120/80 mmHg'
    }
    
    if (requestLower.includes('temperature') || requestLower.includes('temp')) {
        var tempMatch = examSection.match(/temperature:\s*([^,\n]+)/i)
        return tempMatch ? tempMatch[1] : '37.0°C'
    }
    
    if (requestLower.includes('pulse') || requestLower.includes('heart rate')) {
        var pulseMatch = examSection.match(/(?:pulse|heart rate):\s*([^,\n]+)/i)
        return pulseMatch ? pulseMatch[1] : '80 bpm'
    }
    
    if (requestLower.includes('listen to chest') || requestLower.includes('auscult')) {
        var chestMatch = examSection.match(/(?:chest|lung|breath sounds):\s*([^,\n]+)/i)
        return chestMatch ? chestMatch[1] : 'Clear breath sounds bilaterally'
    }
    
    if (requestLower.includes('listen to heart') || requestLower.includes('heart sounds')) {
        var heartMatch = examSection.match(/heart:\s*([^,\n]+)/i)
        return heartMatch ? heartMatch[1] : 'Regular rhythm, no murmurs'
    }
    
    return 'Normal findings'
}

// Extract examination section from case narrative
function extractExamSection(narrative) {
    var examPatterns = [
        /(?:Physical Examination|Examination Findings|Clinical Examination):(.*?)(?:\n\n|\n[A-Z]|$)/s,
        /(?:Tests|Laboratory|Lab Results):(.*?)(?:\n\n|\n[A-Z]|$)/s
    ]
    
    for (var pattern of examPatterns) {
        var match = narrative.match(pattern)
        if (match) {
            return match[1]
        }
    }
    
    return narrative
}

// Detect medical completion signals
function detectMedicalCompletion(providerQuestion) {
    var question = providerQuestion.toLowerCase()
    
    if ((medicalState.phase === 'history' || medicalState.phase === 'examination') && 
        !medicalState.autoTransitionTriggered) {
        
        var completionPhrases = [
            'i am done', 'i\'m done', 'done with questions', 'finished asking',
            'completed questions', 'ready for diagnosis', 'finished questioning',
            'done asking', 'no more questions', 'finished with history'
        ]
        
        return completionPhrases.some(phrase => question.includes(phrase))
    }
    
    return false
}

// Trigger medical transition prompt
async function triggerMedicalTransitionPrompt() {
    if (medicalState.autoTransitionTriggered) return
    
    medicalState.autoTransitionTriggered = true
    medicalState.phase = 'diagnosis'
    
    addMessageToUI('system', 'Interview Phase: DIAGNOSIS', true, null)
    
    setTimeout(async function() {
        var transitionPrompt = "Doctor, I have answered all your questions and completed the exams/tests you've indicated. Could you please share your preliminary diagnosis and treatment plan?"
        
        if (CHAT_LANGUAGE && CHAT_LANGUAGE.toLowerCase() !== 'english') {
            try {
                transitionPrompt = await translateText(transitionPrompt, CHAT_LANGUAGE)
            } catch (error) {
                console.error('Translation failed for transition prompt:', error)
            }
        }
        
        addMessageToUI('assistant', transitionPrompt, true, 'Patient')
        medicalState.messages.push({ role: 'assistant', content: transitionPrompt })
        saveConversation()
        
    }, 1000)
}

// Extract medical condition from case
function extractConditionFromMedicalCase(narrative) {
    var titlePatterns = [
        /(?:Case \d+:|Standardized Patient Case \d+:)\s*([^\n"]+)/i,
        /Case:\s*([^\n"]+)/i,
        /"([^"]+)"/
    ]
    
    for (var pattern of titlePatterns) {
        var match = narrative.match(pattern)
        if (match && match[1]) {
            var condition = match[1].trim()
            condition = condition.replace(/^(Suspected |Early |Acute |Chronic )/i, '')
            return condition
        }
    }
    
    var conditions = ['Asthma', 'Colorectal Cancer', 'Diabetes', 'Tuberculosis', 'Malaria']
    for (var condition of conditions) {
        if (narrative.toLowerCase().includes(condition.toLowerCase())) {
            return condition
        }
    }
    
    return 'the confirmed condition'
}

// Trigger medical treatment reveal
async function triggerMedicalTreatmentReveal() {
    var condition = extractConditionFromMedicalCase(medicalState.caseData.case_narrative)
    
    setTimeout(async function() {
        var revealPrompt = `Later, you find out that the patient was confirmed to be suffering from ${condition}. How would you treat the patient with this information?`
        
        if (CHAT_LANGUAGE && CHAT_LANGUAGE.toLowerCase() !== 'english') {
            try {
                revealPrompt = await translateText(revealPrompt, CHAT_LANGUAGE)
            } catch (error) {
                console.error('Translation failed for reveal prompt:', error)
            }
        }
        
        addMessageToUI('system', revealPrompt, true, 'System')
        medicalState.messages.push({ role: 'assistant', content: revealPrompt })
        saveConversation()
        
    }, 1500)
}

// Extract medical Q&A section
function extractMedicalQASection(narrative) {
    var qaMatch = narrative.match(/Provider Questions.*?(?:with\s+)?(?:SP\s+)?Responses?:(.*?)(?:\n\n[A-Z]|\n(?:Physical|Laboratory|Tests|Diagnosis|Treatment)|$)/s)
    if (qaMatch) {
        return qaMatch[1].trim()
    }
    
    return ''
}

// Find medical Q&A match
function findMedicalQAMatch(question, qaSection) {
    if (!qaSection) return null
    
    var qaPairs = qaSection.split(/\d+\.\s+/).filter(pair => pair.trim().length > 0)
    var questionLower = question.toLowerCase()
    
    var cleanQuestion = questionLower
        .replace(/(?:do you|are you|have you|can you|will you|did you|does|is there|what|when|where|how|why)\s+/g, '')
        .replace(/[?.,!]/g, '')
        .trim()
    
    for (var pair of qaPairs) {
        var lines = pair.split('\n').filter(line => line.trim().length > 0)
        if (lines.length >= 2) {
            var qaQuestion = lines[0].toLowerCase()
            var qaAnswer = lines[1].replace(/^[a-z]\.\s*/i, '').trim()
            
            var cleanQAQuestion = qaQuestion
                .replace(/(?:do you|are you|have you|can you|will you|did you|does|is there|what|when|where|how|why)\s+/g, '')
                .replace(/[?.,!]/g, '')
                .trim()
            
            var questionWords = cleanQuestion.split(/\s+/)
            var qaWords = cleanQAQuestion.split(/\s+/)
            
            var matchCount = 0
            for (var word of questionWords) {
                if (word.length > 2 && qaWords.includes(word)) {
                    matchCount++
                }
            }
            
            if (matchCount >= 2 || cleanQAQuestion.includes(cleanQuestion) || cleanQuestion.includes(cleanQAQuestion)) {
                console.log('Medical Q&A match found:', qaQuestion, '→', qaAnswer)
                return qaAnswer
            }
        }
    }
    
    return null
}

// Detect medical end codes
function detectMedicalEndCodes(aiResponse) {
    if (aiResponse.includes('5j3k')) {
        return { detected: true, code: '5j3k', type: 'problematic_content' }
    }
    
    if (aiResponse.includes('x7y8')) {
        return { detected: true, code: 'x7y8', type: 'end_interview' }
    }
    
    return { detected: false, code: null, type: null }
}

// Generate patient response for medical scenarios
async function generatePatientResponse(providerQuestion) {
    // Medical completion detection
    if (detectMedicalCompletion(providerQuestion)) {
        console.log('Provider completion signal detected, triggering transition prompt')
        triggerMedicalTransitionPrompt()
        
        var ackResponse = "Thank you."
        if (CHAT_LANGUAGE && CHAT_LANGUAGE.toLowerCase() !== 'english') {
            try {
                ackResponse = await translateText("Thank you.", CHAT_LANGUAGE)
            } catch (error) {
                console.error('Translation failed for acknowledgment:', error)
            }
        }
        return ackResponse
    }

    // Medical examination handling
    if (isMedicalExaminationRequest(providerQuestion)) {
        return await generateMedicalExaminationResult(providerQuestion)
    }
    
    // Medical phase transition detection
    var newPhase = detectMedicalPhaseTransition(providerQuestion)
    if (newPhase !== medicalState.phase) {
        console.log(`Medical phase transition: ${medicalState.phase} → ${newPhase}`)
        medicalState.phase = newPhase
        addMessageToUI('system', `Interview Phase: ${newPhase.toUpperCase()}`, true, null)
    }
    
    // Handle treatment phase progression
    if (newPhase === 'treatment' && medicalState.treatmentCount === 0) {
        console.log('First treatment response detected, will trigger condition reveal')
        medicalState.treatmentCount = 1
        
        setTimeout(function() {
            triggerMedicalTreatmentReveal()
        }, 3000)
    }

    // Auto-completion after second treatment
    if (medicalState.phase === 'treatment' && medicalState.treatmentCount >= 1) {
        var treatmentKeywords = ['treat', 'medication', 'prescribe', 'therapy', 'management']
        var hasKeywords = treatmentKeywords.some(keyword => 
            providerQuestion.toLowerCase().includes(keyword)
        )
        
        if (hasKeywords && medicalState.treatmentCount === 1) {
            console.log('Second treatment response detected, scheduling auto-completion')
            medicalState.treatmentCount = 2
            
            setTimeout(function() {
                // Use x7y8 for normal completion, not 5j3k
                var completionMessage = 'Thank you for your evaluation, Doctor. This concludes our simulated patient encounter. Code escape: x7y8'
                handleMedicalInterviewEnd(completionMessage, { detected: true, code: 'x7y8', type: 'end_interview' })
            }, 2000)
        }
    }
    
    // Check for direct medical Q&A match
    var qaSection = extractMedicalQASection(medicalState.caseData.case_narrative)
    var directAnswer = findMedicalQAMatch(providerQuestion, qaSection)
    
    if (directAnswer && medicalState.phase === 'history') {
        console.log('Using direct medical Q&A response')
        
        if (CHAT_LANGUAGE && CHAT_LANGUAGE.toLowerCase() !== 'english') {
            return await translateText(directAnswer, CHAT_LANGUAGE)
        }
        return directAnswer
    }
    
    // Generate AI response with medical context
    var phaseInstruction = getMedicalPhaseInstruction(medicalState.phase)
    var messages = [
        { role: 'system', content: medicalState.completeSystemPrompt + phaseInstruction },
        ...medicalState.messages,
        { role: 'user', content: providerQuestion }
    ]
    
    var aiResponse = await sendToOpenAI(messages)
    return aiResponse
}

// Add message to UI with medical role detection
function addMessageToUI(role, content, animate, speaker) {
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
    
    var headerDiv = document.createElement('div')
    headerDiv.className = 'message-header'
    
    if (role === 'user') {
        headerDiv.textContent = 'Provider:'
    } else if (role === 'system') {
        headerDiv.textContent = 'System:'
    } else {
        if (speaker) {
            headerDiv.textContent = speaker + ':'
        } else {
            // Medical role detection
            var isNurseContent = (
                content.toLowerCase().includes('hello doctor') ||
                content.toLowerCase().includes('a nurse performs') ||
                content.toLowerCase().includes('nurse performs')
            )
            
            var isSystemContent = (
                content.toLowerCase().includes('later, you find out') ||
                content.toLowerCase().includes('interview phase:') ||
                content.toLowerCase().includes('medical consultation')
            )
            
            if (isNurseContent) {
                headerDiv.textContent = 'Nurse:'
            } else if (isSystemContent) {
                headerDiv.textContent = 'System:'
            } else {
                headerDiv.textContent = 'Patient:'
            }
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

    if (isTimedOut) {
        console.log('Message blocked - session timed out')
        return
    }

    if (message.toLowerCase() === 'quit') {
        handleMedicalInterviewEnd('Interview ended by provider.', { detected: true, code: 'x7y8', type: 'user_quit' })
        return
    }
    
    if (!message) return
    
    userInput.disabled = true
    sendButton.disabled = true
    loadingIndicator.style.display = 'block'
    
    try {
        medicalState.messages.push({ role: 'user', content: message })
        addMessageToUI('user', message, true, null)
        userInput.value = ''
        
        var aiResponse
        
        if (medicalState.awaitingLanguageSelection) {
            await handleLanguageSelection(message)
        } else {
            aiResponse = await generatePatientResponse(message)
            
            // Check for medical end codes
            var endCode = detectMedicalEndCodes(aiResponse)
            if (endCode.detected) {
                handleMedicalInterviewEnd(aiResponse, endCode)
            } else {
                medicalState.messages.push({ role: 'assistant', content: aiResponse })
                addMessageToUI('assistant', aiResponse, true, null)
            }
        }
        
        saveConversation()
        updateClearButtonVisibility()
        clearUnsentInput()
        
    } catch (error) {
        console.error('Error sending message:', error)
        var errorMessage = 'Sorry, I encountered an error: ' + error.message
        addMessageToUI('assistant', errorMessage, true, null)
    } finally {
        userInput.disabled = false
        sendButton.disabled = false
        loadingIndicator.style.display = 'none'
        userInput.focus()
    }
}

// Handle medical interview end
function handleMedicalInterviewEnd(response, endCode) {
    console.log('Medical interview ending with code:', endCode.code)
    
    // Clean response of end codes
    var cleanResponse = response.replace(/5j3k|x7y8/g, '').trim()
    
    if (cleanResponse) {
        addMessageToUI('system', cleanResponse, true, 'System')
    }
    
    // Add specific medical completion messages
    if (endCode.code === '5j3k') {
        addMessageToUI('system', 'Session terminated due to inappropriate content.', true, null)
    } else if (endCode.code === 'x7y8') {
        addMessageToUI('system', 'Medical consultation completed successfully.', true, null)
    }
    
    // Add medical interview summary
    addMessageToUI('system', '=== Medical Interview Summary ===', true, null)
    var providerMessages = medicalState.messages.filter(msg => msg.role === 'user')
    var patientMessages = medicalState.messages.filter(msg => msg.role === 'assistant')
    
    addMessageToUI('system', `Total medical exchanges: ${Math.min(providerMessages.length, patientMessages.length)}`, true, null)
    addMessageToUI('system', `Final phase: ${medicalState.phase}`, true, null)
    
    // Use custom end message
    addMessageToUI('system', END_MESSAGE, true, null)
    
    // Disable further input
    userInput.disabled = true
    sendButton.disabled = true
    if (clearButton) clearButton.disabled = true
    if (completeButton) completeButton.style.display = 'none'
    
    medicalState.stage = 'complete'
    saveConversation()
}

// Clear medical interview
function clearMedicalInterview() {
    if (medicalState.messages.length === 0) return
    
    if (!CLEAR_BUTTON_LABEL) return
    
    var confirmClear = confirm(CLEAR_WARNING_TEXT)
    
    if (confirmClear) {
        medicalState.messages = []
        conversationData.value = ''
        setAnswer('')
        medicalState.phase = 'history'
        medicalState.treatmentCount = 0
        medicalState.autoTransitionTriggered = false
        medicalState.nurseIntroduced = false
        
        medicalState.initialized = false
        initializeMedicalConversation()
        updateClearButtonVisibility()
        
        if (userInput) {
            userInput.focus()
        }
    }
}

// Update button visibility
function updateClearButtonVisibility() {
    if (clearButton && CLEAR_BUTTON_LABEL) {
        clearButton.style.display = medicalState.messages.length > 0 ? 'block' : 'none'
    } else if (clearButton) {
        clearButton.style.display = 'none'
    }
    
    if (completeButton) {
        completeButton.style.display = medicalState.messages.length > 0 ? 'block' : 'none'
    }
}

// Save conversation
function saveConversation() {
    var conversationString = JSON.stringify(medicalState.messages)
    conversationData.value = conversationString
    setAnswer(conversationString)
}

// Complete medical interview
function completeMedicalInterview() {
    var confirmComplete = confirm(COMPLETE_WARNING_TEXT)
    
    if (confirmComplete) {
        medicalState.messages.push({ role: 'system', content: '__MEDICAL_INTERVIEW_COMPLETED__' })
        saveConversation()
        
        userInput.disabled = true
        sendButton.disabled = true
        completeButton.style.display = 'none'
        
        addMessageToUI('system', 'Medical interview completed.', true, null)
    }
}

// Clear answer (called by SurveyCTO)
function clearAnswer() {
    medicalState.messages = []
    conversationData.value = ''
    medicalState.initialized = false
    medicalState.phase = 'history'
    medicalState.treatmentCount = 0
    medicalState.autoTransitionTriggered = false
    medicalState.nurseIntroduced = false
    medicalState.awaitingLanguageSelection = false
    
    if (suggestedPromptsContainer) {
        suggestedPromptsContainer.innerHTML = ''
        clearUnsentInput()
    }
    
    initializeMedicalConversation()
    updateClearButtonVisibility()
    isTimedOut = false
    stopActivityTimer()
    if (TIMEOUT_SECONDS > 0 && !fieldProperties.READONLY) {
        resetActivityTimer()
    }
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

// Handle language selection
async function handleLanguageSelection(userResponse) {
    console.log('Processing language selection:', userResponse)
    
    var selectedLanguage = extractLanguageFromResponse(userResponse)
    
    if (selectedLanguage) {
        medicalState.selectedLanguage = selectedLanguage
        medicalState.awaitingLanguageSelection = false
        
        console.log('Language selected:', selectedLanguage)
        
        CHAT_LANGUAGE = selectedLanguage
        
        var confirmationMessage = `Proceeding with medical consultation in ${selectedLanguage}.`
        addMessageToUI('system', confirmationMessage, true, 'System')
        medicalState.messages.push({ role: 'system', content: confirmationMessage })
        
        await setupMedicalCaseData()
        await showMedicalInitialMessages()
        
    } else {
        var clarificationMessage = "I didn't understand the language. Please specify which language you'd like to use for this medical consultation (e.g., English, Spanish, French, etc.)."
        addMessageToUI('assistant', clarificationMessage, true, 'System')
        medicalState.messages.push({ role: 'assistant', content: clarificationMessage })
    }
    
    saveConversation()
}

// Extract language from response
function extractLanguageFromResponse(response) {
    var responseLower = response.toLowerCase().trim()
    
    var languageMap = {
        'english': 'English',
        'spanish': 'Spanish', 'español': 'Spanish', 'espanol': 'Spanish',
        'french': 'French', 'français': 'French', 'francais': 'French',
        'german': 'German', 'deutsch': 'German',
        'italian': 'Italian', 'italiano': 'Italian',
        'portuguese': 'Portuguese', 'português': 'Portuguese', 'portugues': 'Portuguese',
        'chinese': 'Chinese', 'mandarin': 'Chinese',
        'arabic': 'Arabic', 'العربية': 'Arabic',
        'hindi': 'Hindi', 'हिंदी': 'Hindi',
        'swahili': 'Swahili', 'kiswahili': 'Swahili',
        'hausa': 'Hausa',
        'yoruba': 'Yoruba'
    }
    
    for (var key in languageMap) {
        if (responseLower.includes(key)) {
            return languageMap[key]
        }
    }
    
    if (response.length > 1 && response.length < 20) {
        return response.charAt(0).toUpperCase() + response.slice(1).toLowerCase()
    }
    
    return null
}

async function showMedicalNurseIntroduction() {
    var patientInfo = extractPatientInfo(CASE_DATA)
    var nursePrompt = `Hello Doctor, I have ${patientInfo.name || 'a patient'} here who is ready for consultation. I can assist you by performing rapid tests or clinical examinations as needed during your evaluation. Please let me know when you have completed your questions and exams so we can proceed to diagnosis and treatment.`
    
    addMessageToUI('assistant', nursePrompt, false, 'Nurse')
    medicalState.messages.push({ role: 'assistant', content: nursePrompt })
    medicalState.nurseIntroduced = true
    
    saveConversation()
}

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
    
    // Don't reset timer if already timed out or if timeout is disabled
    if (isTimedOut || TIMEOUT_SECONDS <= 0 || userInput.disabled) {
        return
    }
    
    // Clear existing timer
    if (timeoutTimer) {
        clearTimeout(timeoutTimer)
        timeoutTimer = null
    }
    
    // Set new timer
    timeoutTimer = setTimeout(function() {
        handleTimeout()
    }, TIMEOUT_SECONDS * 1000)
    
    console.log('Activity timer reset. Timeout in', TIMEOUT_SECONDS, 'seconds')
}

function handleTimeout() {
    console.log('Interaction timed out after', TIMEOUT_SECONDS, 'seconds of inactivity')
    
    isTimedOut = true
    
    // Add timeout message to conversation
    var timeoutMessage = `Session timed out after ${TIMEOUT_SECONDS} seconds of inactivity. Interaction has been locked.`
    addMessageToUI('system', timeoutMessage, true, 'System')
    
    // Disable all input controls
    userInput.disabled = true
    sendButton.disabled = true
    if (clearButton) clearButton.disabled = true
    if (completeButton) completeButton.style.display = 'none'
    
    // Update input placeholder
    userInput.placeholder = 'Session timed out - interaction locked'
    
    // Save timeout state to conversation
    medicalState.messages.push({ role: 'system', content: '__SESSION_TIMEOUT__' })
    saveConversation()
    
    // Stop the timer
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
    // Check if conversation contains timeout marker
    return medicalState.messages.some(msg => msg.content === '__SESSION_TIMEOUT__')
}

// Show medical language selection prompt
async function showMedicalLanguageSelectionPrompt() {
    var patientInfo = extractPatientInfo(CASE_DATA)
    var nursePrompt = `Hello Doctor, I have ${patientInfo.name || 'a patient'} here who is ready for consultation. I can assist you by performing rapid tests or clinical examinations as needed during your evaluation. Please let me know when you have completed your questions and exams so we can proceed to diagnosis and treatment. Which language would you prefer to use for this consultation?`
    
    addMessageToUI('assistant', nursePrompt, false, 'Nurse')
    medicalState.messages.push({ role: 'assistant', content: nursePrompt })
    medicalState.awaitingLanguageSelection = true
    medicalState.nurseIntroduced = true
    
    saveConversation()
}

// Setup medical case data
async function setupMedicalCaseData() {
    console.log('Setting up medical case data...')
    console.log('Language parameter:', CHAT_LANGUAGE)
    
    if (!CHAT_LANGUAGE) {
        console.log('No language set, will prompt for language selection first')
        return
    }
    
    var validationErrors = validateMedicalParameters()
    if (validationErrors.length > 0) {
        throw new Error('Missing required parameters: ' + validationErrors.join(', '))
    }
    
    var caseData = loadMedicalCaseFromParameter()
    medicalState.caseData = caseData
    
    medicalState.patientInfo = extractPatientInfo(caseData.case_narrative)
    medicalState.phase = 'history'
    
    medicalState.completeSystemPrompt = buildMedicalSystemPrompt(
        SYSTEM_PROMPT_BASE,
        INTERVIEW_OUTLINE,
        caseData.case_narrative,
        CHAT_LANGUAGE
    )
    
    medicalState.stage = 'initial'
    console.log('Medical case data setup complete for language:', CHAT_LANGUAGE)
}

// Show medical initial messages
async function showMedicalInitialMessages() {
    if (!medicalState.caseData) return
    
    // Only show nurse introduction if nurse hasn't been introduced yet
    if (!medicalState.nurseIntroduced) {
        await showMedicalNurseIntroduction()
    }
    
    // Show patient opening statement
    var patientOpening = medicalState.patientInfo.openingStatement
    
    if (CHAT_LANGUAGE && CHAT_LANGUAGE.toLowerCase() !== 'english') {
        patientOpening = await translateText(patientOpening, CHAT_LANGUAGE)
    }
    
    setTimeout(function() {
        addMessageToUI('assistant', patientOpening, false, 'Patient')
        medicalState.messages.push({ role: 'assistant', content: patientOpening })
        saveConversation()
    }, 500)
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
            if (!userInput.disabled) {
                userInput.value = prompt
                sendMessage()
            }
        }
        suggestedPromptsContainer.appendChild(button)
    })
    
    console.log('Initialized', prompts.length, 'medical suggested prompts')
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

// Main medical conversation initialization
async function initializeMedicalConversation() {
    if (medicalState.initialized) {
        console.log('Medical conversation already initialized, skipping...')
        return
    }
    
    try {
        console.log('Initializing medical conversation...')
        
        if (loadingIndicator) {
            loadingIndicator.style.display = 'block'
            loadingIndicator.querySelector('span').textContent = 'Initializing medical consultation...'
        }
        
        initializeButtons()
        initializeSuggestedPrompts()
        conversationDisplay.innerHTML = ''
        
        var hasSavedData = conversationData && conversationData.value
        var savedMessages = []
        
        if (hasSavedData) {
            try {
                savedMessages = JSON.parse(conversationData.value)
                medicalState.messages = savedMessages
                console.log('Loaded saved medical conversation with', savedMessages.length, 'messages')
            } catch (e) {
                console.error('Error parsing saved medical conversation:', e)
                savedMessages = []
                medicalState.messages = []
            }
        }
        
        if (savedMessages.length > 0) {
            // Display saved messages
            savedMessages.forEach(function(message) {
                addMessageToUI(message.role, message.content, false, null)
            })
            
            if (CHAT_LANGUAGE) {
                await setupMedicalCaseData()
            }
        } else {
            // New conversation
            if (CHAT_LANGUAGE) {
                // Language provided: setup case data and show nurse intro + patient opening
                await setupMedicalCaseData()
                await showMedicalInitialMessages()
            } else {
                // No language provided: show language selection prompt
                await showMedicalLanguageSelectionPrompt()
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
        } else {
            // Start timeout timer for new/active sessions
            if (TIMEOUT_SECONDS > 0 && !fieldProperties.READONLY) {
                resetActivityTimer()
            }
            
            // Restore any unsent input from previous session
            restoreUnsentInput()
        }
        
        console.log('Medical conversation initialization complete')
        
    } catch (error) {
        console.error('Error during medical conversation initialization:', error)
        conversationDisplay.innerHTML = ''
        addMessageToUI('assistant', `Error initializing medical simulation: ${error.message}. Please check your parameters and try again.`, true, null)
        medicalState.initialized = true
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
        clearButton.addEventListener('click', clearMedicalInterview)
    }

    if (completeButton) {
        completeButton.addEventListener('click', completeMedicalInterview)
    }
    
    userInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
    })
}

if (!fieldProperties.READONLY && userInput) {
    // Save input as user types
    userInput.addEventListener('input', saveUnsentInput)
    
    // Save input when field loses focus
    userInput.addEventListener('blur', saveUnsentInput)
    
    // Save input when user presses keys (for additional safety)
    userInput.addEventListener('keyup', saveUnsentInput)
}

// Timeout functionality - track user activity
if (TIMEOUT_SECONDS > 0 && !fieldProperties.READONLY) {
    console.log('Timeout functionality enabled:', TIMEOUT_SECONDS, 'seconds')
    
    // Track user input activity
    userInput.addEventListener('input', resetActivityTimer)
    userInput.addEventListener('keypress', resetActivityTimer)
    userInput.addEventListener('keydown', resetActivityTimer)
    userInput.addEventListener('focus', resetActivityTimer)
    
    // Track button clicks
    sendButton.addEventListener('click', resetActivityTimer)
    if (clearButton) {
        clearButton.addEventListener('click', resetActivityTimer)
    }
    if (completeButton) {
        completeButton.addEventListener('click', resetActivityTimer)
    }
    
    // Track suggested prompt clicks
    if (suggestedPromptsContainer) {
        suggestedPromptsContainer.addEventListener('click', resetActivityTimer)
    }
}

// Handle page visibility changes for timeout
if (TIMEOUT_SECONDS > 0) {
    document.addEventListener('visibilitychange', function() {
        if (isTimedOut) {
            return // Don't reset timer if already timed out
        }
        
        if (document.hidden) {
            // Page is hidden, stop timer but don't reset activity time
            console.log('Page hidden, stopping activity timer')
            stopActivityTimer()
        } else {
            // Page is visible, restart timer from last activity
            console.log('Page visible, restarting activity timer')
            var timeSinceLastActivity = Date.now() - lastActivityTime
            var remainingTime = (TIMEOUT_SECONDS * 1000) - timeSinceLastActivity
            
            if (remainingTime <= 0) {
                // Should have already timed out
                handleTimeout()
            } else {
                // Restart timer with remaining time
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
// Start medical conversation initialization
console.log('Medical script loaded, starting initialization...')
initializeMedicalConversation()
