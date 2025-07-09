# Chatbot Demo Field Plugin

![Chatbot field plug-in interface](extras/preview.jpg)

## Description

An interactive chatbot field plugin that integrates with OpenAI's API to provide conversational AI capabilities within SurveyCTO forms. This plugin allows users to have natural language conversations with an AI assistant and saves the conversation data for analysis.

[![Download now](extras/download-button.png)](https://github.com/surveycto/chatbot-demo/raw/master/chatbot-demo.fieldplugin.zip)

### Features

This field plug-in offers comprehensive medical interview simulation:

1. **Structured Interview Phases**  
   Automatic progression through History Taking → Physical Examination → Diagnosis → Treatment phases with intelligent phase detection and transitions.

2. **Standardized Patient Simulation**  
   AI-powered patient responses based on detailed medical case narratives with consistent, case-specific answers to provider questions.

3. **Physical Examination & Laboratory Simulation**  
   Realistic examination results and laboratory tests extracted from case data, with nurse-mediated test administration.

4. **Case-Specific Structured Q&A**  
   Prioritizes exact answers from structured Q&A pairs when available, with AI improvisation for unstructured questions.

5. **Multi-language Medical Interviews**  
   Conducts interviews in multiple languages with medical terminology translation and culturally appropriate responses.

6. **Role-Based Message Classification**  
   Distinguishes between Provider, Patient, Nurse, and System messages with appropriate visual labeling.

7. **Suggested Medical Prompts**  
   Customizable prompt buttons for common medical questions and examination requests.

8. **Advanced Conversation Management**  
   Save interview transcripts, clear conversations, mark completion, with custom end messages and warnings.

### Medical Interview Workflow

The plugin follows a structured medical interview process:

**Phase 1: History Taking**

- Patient presents chief complaint
- Provider asks symptom-specific questions
- AI responds with case-specific answers from Q&A pairs or narrative

**Phase 2: Physical Examination**

- Provider requests examinations or tests
- Nurse performs procedures and reports results
- Automatic transition to examination phase

**Phase 3: Diagnosis**

- Provider presents preliminary diagnosis
- System prompts for treatment discussion
- Transition to treatment phase

**Phase 4: Treatment**

- Provider discusses treatment plan
- Interview concludes with end codes or completion

### Data Format

This field plug-in requires the `text` field type and saves the complete interview transcript as JSON data including all provider questions, patient responses, examination results, and phase transitions.

## How to use

### Getting started

**To use this plug-in**, download the plugin file, configure the required medical case parameters, and attach it to your form with the appropriate field appearance.

### Required Parameters

| Parameter key   | Parameter value                 | Description                                          |
| --------------- | ------------------------------- | ---------------------------------------------------- |
| `api-key`       | Your OpenAI API key             | **Required** - Get from OpenAI platform              |
| `system_prompt` | Base system prompt              | **Required** - Core AI behavior instructions         |
| `outline`       | Interview workflow instructions | **Required** - Structured interview phase guidelines |
| `medical_cases` | Case narrative data             | **Required** - Patient case background and Q&A pairs |

### Optional Parameters

| Parameter key           | Parameter value            | Description                                                                                 |
| ----------------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| `model`                 | OpenAI model name          | Optional - Defaults to 'gpt-4.1-mini-2025-04-14'                                            |
| `language`              | Target language            | Optional - Defaults to 'English', supports medical translation                              |
| `selected_case`         | Case identifier            | Optional - For case library systems                                                         |
| `suggested-prompts`     | Pipe-separated prompt list | Optional - Medical question buttons (e.g., "Check vital signs\|Examine chest\|Order tests") |
| `end-message`           | Custom completion message  | Optional - Personalized interview conclusion                                                |
| `clear-button-label`    | Button text                | Optional - If provided, shows clear button with this label                                  |
| `complete-button-label` | Button text                | Optional - Label for complete button (defaults to ✓)                                        |
| `clear-warning-text`    | Warning message            | Optional - Custom warning when clearing conversation                                        |
| `complete-warning-text` | Warning message            | Optional - Custom warning when completing interview                                         |

### Setup Instructions

1. **Get OpenAI API Key**

   - Sign up at [OpenAI](https://platform.openai.com/)
   - Generate an API key from your account settings

2. **Configure Form**

   - Add a `text` field to your form
   - Set the appearance to use this plugin
   - Add the required `api-key` parameter
   - Optionally configure `model`, `language`, and `system-message` parameters

3. **Deploy**
   - Upload the form to your SurveyCTO server
   - Attach the field plugin file
   - Test the conversation functionality

### Example Field Configuration

```
custom-medical-interview(
    api-key=your_openai_api_key_here;
    system_prompt="You are simulating a standardized patient...";
    outline="Conduct structured medical interview phases...";
    medical_cases="Angela is a 24-year-old woman with breathing difficulties...";
    language=English;
    suggested-prompts=Tell me about your symptoms|When did this start?|Any family history?|Let me examine your chest;
    end-message=Thank you for completing this medical consultation.
)
```

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
