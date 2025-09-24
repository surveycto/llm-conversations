# LLM Conversations Field Plugin

![llm-conversations field plug-in interface](extras/preview.jpg)

## Description

A flexible conversational AI field plugin that integrates with OpenAI's API to provide customizable chatbot interactions within SurveyCTO forms. This plugin is completely prompt-driven and can adapt to any business case or workflow based on the system prompt provided.

[![Download now](extras/download-button.png)](https://github.com/surveycto/chatbot-demo/raw/master/chatbot-demo.fieldplugin.zip)

### Features

This field plug-in offers comprehensive conversational AI capabilities:

1. **Completely Flexible and Prompt-Driven**  
   Adapts to any business case, workflow, or conversational scenario based on the system prompt provided. No hardcoded business logic.

2. **Dual-Parameter System**  
   Supports both `system_prompt` (core instructions) and `case_data` (specific context/scenarios) parameters for organized prompt management.

3. **Flexible End Code Detection**  
   Automatically detects conversation completion codes (`5j3k`, `x7y8`, `END_CONVERSATION`, etc.) with flexible pattern matching.

4. **Advanced Conversation Management**  
   Save conversation transcripts, clear conversations, mark completion, with customizable end messages and warnings.

5. **Timeout and Session Management**  
   Configurable session timeouts with automatic locking, input preservation, and timeout state persistence.

6. **Customizable Conversation Starters**  
   Control how conversations begin with the `conversation-starter` parameter.

7. **Suggested Prompts Support**  
   Configurable prompt buttons for common questions or actions relevant to your use case.

8. **Multi-Language Support**  
   Works with any language supported by OpenAI's models when configured in the system prompt.

9. **Role-Based Interactions**  
   Supports role-switching and character-based conversations when specified in the system prompt.

10. **Robust Error Handling**  
    Graceful handling of API errors, network issues, and conversation state problems.

### Conversation Workflow

The plugin follows a completely flexible workflow determined by your system prompt:

**Generic Flow:**

1. **Initialization** - AI generates opening message based on system prompt and conversation starter
2. **Interactive Exchange** - User and AI exchange messages according to prompt instructions
3. **Completion Detection** - Plugin detects end codes or completion signals from AI responses
4. **Conversation Conclusion** - Session ends with customizable completion message

**Example Use Cases:**

- **Medical Interviews**: Standardized patient simulations with structured phases
- **Customer Service**: Support conversations with escalation workflows
- **Research Interviews**: Structured data collection with follow-up questions
- **Training Simulations**: Role-playing scenarios for skill development
- **Educational Conversations**: Tutoring or Q&A sessions with adaptive responses

### Data Format

This field plug-in requires the `text` field type and saves the complete conversation transcript as JSON data including all user inputs, AI responses, and system messages.

## How to use

### Getting started

**To use this plug-in**, download the plugin file, configure the required parameters, and attach it to your form with the appropriate field appearance.

### Required Parameters

| Parameter key   | Parameter value      | Description                                          |
| --------------- | -------------------- | ---------------------------------------------------- |
| `system_prompt` | Core AI instructions | **Required** - Main behavioral guidelines for the AI |
| `api-key`       | Your OpenAI API key  | **Required** - Your OpenAI API key |

### Optional Parameters

| Parameter key           | Parameter value              | Description                                                                                               |
| ----------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `case_data`             | Specific scenario context    | Optional - Additional context, scenarios, or structured data (combined with system_prompt)                |
| `conversation-starter`  | Initial conversation trigger | Optional - Custom message to start conversations (default: "Please begin the conversation as instructed") |
| `model`                 | OpenAI model name            | Optional - Defaults to 'gpt-4o-mini'                                                                      |
| `timeout`               | Seconds (integer)            | Optional - Auto-lock after inactivity (default: 600 seconds/10 minutes, set to 0 to disable)              |
| `suggested-prompts`     | Pipe-separated prompt list   | Optional - Custom buttons (e.g., "Ask about symptoms\|Schedule follow-up\|End conversation")              |
| `end-message`           | Custom completion message    | Optional - Personalized conversation conclusion                                                           |
| `clear-button-label`    | Button text                  | Optional - If provided, shows clear button with this label                                                |
| `complete-button-label` | Button text                  | Optional - Label for complete button (defaults to ✓)                                                      |
| `clear-warning-text`    | Warning message              | Optional - Custom warning when clearing conversation                                                      |
| `complete-warning-text` | Warning message              | Optional - Custom warning when completing conversation                                                    |
| `send-button-label`     | Button text                  | Optional - Label for send button (defaults to "Send")                                                     |

### Connection and Performance Parameters

| Parameter key        | Parameter value    | Description                                                                    |
| -------------------- | ------------------ | ------------------------------------------------------------------------------ |
| `request-timeout`    | Milliseconds       | Optional - Initial connection timeout (default: 30000ms/30s)                   |
| `stream-timeout`     | Milliseconds       | Optional - Time between stream chunks (default: 15000ms/15s)                   |
| `stream-max-wait`    | Milliseconds       | Optional - Maximum total stream time (default: 60000ms/60s)                    |
| `max-retries`        | Integer            | Optional - Number of retry attempts (default: 3)                               |
| `retry-delay`        | Milliseconds       | Optional - Base delay between retries (default: 2000ms/2s, uses exponential backoff) |
| `streaming-fallback` | true/false         | Optional - Enable fallback to non-streaming (default: true)                    |

### Setup Instructions

1. **Get OpenAI API Key**
   - Sign up at [OpenAI](https://platform.openai.com/)
   - Generate an API key from your account settings

2. **Configure Form**
   - Add a `text` field to your form
   - Set the appearance to use this plugin
   - Add the required `api-key` and `system_prompt` parameters
   - Optionally configure `model` (default: gpt-4o-mini), `case_data`, etc.

3. **Deploy**
   - Upload the form to your SurveyCTO server
   - Attach the field plugin file
   - Test the conversation functionality

### Example Field Configuration

```
custom-chatbot(
    api-key=your_openai_api_key_here,
    model=gpt-4o-mini,
    system_prompt="You are a standardized patient for medical training. Follow these guidelines...",
    case_data="Patient: Angela, 24-year-old female with breathing difficulties...",
    conversation-starter="Please begin as the nurse introducing the patient",
    timeout=600,
    suggested-prompts='Tell me about your symptoms|When did this start?|Any family history?|Let me examine you',
    end-message='Thank you for completing this medical consultation.'
)
```

### Session Management

**Timeout Behavior:**

- Sessions automatically lock after configured inactivity period (default: 10 minutes)
- Timeout can be customized or disabled via the `timeout` parameter
- Inactivity timer pauses when page is not visible
- Timeout state persists across form navigation
- Clear button resets timeout state

**Connection Resilience:**

- Automatic retry with exponential backoff for failed requests
- Configurable timeouts for different connection phases
- Streaming fallback for unreliable connections
- Preserved user input on connection failures
- Clean error recovery without page reloads

**Input Preservation:**

- Typed but unsubmitted text is automatically saved
- Input is restored when returning to the field
- Cleared when message is successfully sent
- Cleared when conversation is cleared

**End Code Detection:**
The plugin automatically detects various conversation completion patterns:

- Standalone codes: `5j3k`, `x7y8`, `END_CONVERSATION`, `TERMINATE`, `COMPLETE`
- Codes in text: "Thank you. Code escape: 5j3k"
- Flexible pattern matching for custom end signals

### Default SurveyCTO feature support

| Feature / Property      | Support                               |
| ----------------------- | ------------------------------------- |
| Supported field type(s) | `text`                                |
| Default values          | Yes _(loads previous conversation)_   |
| Constraint message      | Uses default behavior                 |
| Required message        | Uses default behavior                 |
| Read only               | Yes _(displays conversation history)_ |
| media:image             | Yes                                   |
| media:audio             | Yes                                   |
| media:video             | Yes                                   |

## Security Considerations

- Store API keys securely and avoid exposing them in form definitions
- Consider data privacy implications when sending conversation data to OpenAI
- Review OpenAI's data usage policies for your use case
- Test thoroughly before deploying in production

## Best Practices

### System Prompt Design

- Be specific and explicit about desired behavior
- Include error handling instructions
- Define clear conversation flow rules
- Use examples to illustrate expected responses
- Test with various input scenarios

### Performance Optimization

- Keep system prompts concise but comprehensive
- Use appropriate OpenAI model for your use case
- Monitor token usage and costs
- Implement reasonable conversation length limits

### User Experience

- Provide clear instructions to users
- Use suggested prompts for common actions
- Set appropriate timeout values for your use case
- Test on various devices and screen sizes
- Consider offline scenarios and error states

### Connection Optimization

- Adjust timeout parameters based on your typical network conditions
- Use higher retry counts for unreliable connections
- Enable streaming fallback for better reliability
- Monitor error patterns and adjust parameters accordingly

## Troubleshooting
### Common Connection Issues

**"Connection interrupted" errors:**
- Increase `stream-timeout` and `stream-max-wait` parameters
- Enable `streaming-fallback` if not already enabled
- Check network stability

**"Request timed out" errors:**
- Increase `request-timeout` parameter
- Increase `max-retries` for unreliable connections
- Consider using a more stable network connection

**Frequent retry attempts:**
- Check API key validity
- Verify OpenAI service status
- Adjust `retry-delay` to reduce server load

## Testing the Plugin

To test the plugin:

1. **Basic Test Configuration**
   ```
   custom-chatbot(
       api-key=your_openai_api_key_here,
       model=gpt-4o-mini,
       system_prompt="You are a helpful assistant. Always end responses with the code '5j3k' when the conversation should end.",
       conversation-starter="Hello! How can I help you today?",
       suggested-prompts="What can you do?|Tell me a joke|Help me with math|End conversation"
   )
   ```

2. **Testing Checklist**
   - ✅ Conversation starts properly
   - ✅ AI responds appropriately to prompts
   - ✅ Streaming works (real-time text display)
   - ✅ End codes are detected (test with "Please end the conversation")
   - ✅ Error handling works (test with invalid API key)
   - ✅ Button layout works (Send button rightmost, Complete button is red)

## More resources

- **Test form**  
  This form will help you explore the chatbot functionality and test different configurations.  
  [Download test form package](extras/test-form/test-form-package.zip)  
  [Instructions for test form](extras/test-form/README.md)

- **Developer documentation**  
  Instructions and resources for developing your own field plug-ins.  
  [https://github.com/surveycto/Field-plug-in-resources](https://github.com/surveycto/Field-plug-in-resources)

- **User documentation**  
  How to get started using field plug-ins in your SurveyCTO form.  
  [https://docs.surveycto.com/02-designing-forms/03-advanced-topics/06.using-field-plug-ins.html](https://docs.surveycto.com/02-designing-forms/03-advanced-topics/06.using-field-plug-ins.html)

- **OpenAI API Documentation**  
  [https://platform.openai.com/docs](https://platform.openai.com/docs)

## Platform Compatibility

### Android Support
**Recommended: Android 9.0+ (API 28 and above)**

The chatbot plugin uses modern JavaScript features including async/await, AbortController, and streaming fetch APIs. While these features may work on some Android 8.1+ devices with updated WebView, Android 9.0+ provides guaranteed compatibility and reliable performance.

For maximum compatibility across all devices in your deployment:
- **Android 9.0+**: Full native support, no issues expected
- **Android 8.1+**: May work with updated Chrome WebView (not guaranteed)
- **Android 8.0 and below**: Not recommended, requires significant code modifications

If you need to support older Android versions, consider implementing the compatibility fallbacks mentioned in the troubleshooting section.
