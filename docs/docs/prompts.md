# Prompts Documentation

## Overview

The Prompts system is a comprehensive prompt management and execution platform that enables developers and AI practitioners to create, manage, version, and execute prompts for Large Language Models (LLMs). It provides a centralized repository for prompt templates with advanced features like versioning, testing, and seamless integration with agent execution workflows.

## Key Features and Benefits

### Prompt Management
- **CRUD Operations**: Create, read, update, and delete prompts with full lifecycle management
- **Versioning System**: Track prompt revisions and maintain version history
- **Metadata Preservation**: Store and manage prompt settings, parameters, and context
- **Template System**: Support for dynamic prompt templates with variable substitution

### Integration Capabilities
- **Agent LLM Integration**: Direct integration with agent execution history and LLM calls
- **Cross-Platform Support**: Works with multiple LLM providers and frameworks
- **Message Preservation**: Maintain conversation context and message history
- **Settings Migration**: Transfer LLM settings and configurations between prompts

### Prompt Studio
- **Interactive Testing**: Real-time prompt experimentation and refinement
- **Live Preview**: See prompt output as you make changes
- **Parameter Tuning**: Adjust model parameters and settings in real-time
- **Comparison Tools**: Compare different prompt versions and their outputs

## Getting Started

### Creating Your First Prompt

1. **Navigate to Prompt Library**: Access the prompt management interface
2. **Create New Prompt**: Click "New Prompt" to start the creation process
3. **Define Template**: Write your prompt template with placeholders for variables
4. **Set Parameters**: Configure model settings, temperature, max tokens, etc.
5. **Save and Test**: Save your prompt and test it in the Prompt Studio

Example prompt creation:
```typescript
const newPrompt = {
  name: "Code Review Assistant",
  template: "Review the following code for {language} and provide feedback on:\n{code}\n\nFocus on: {focus_areas}",
  parameters: {
    temperature: 0.3,
    maxTokens: 1000,
    model: "gpt-4"
  }
};
```

### Loading Agent LLM Calls

The system provides seamless integration with agent execution history:

1. **Access Agent History**: Navigate to your agent's execution logs
2. **Select LLM Call**: Choose the specific LLM interaction you want to convert
3. **Open in Prompt Studio**: Use the `openInPromptStudio()` function
4. **Review and Save**: The system preserves messages, settings, and metadata

## Advanced Features

### Prompt Versioning and Revisions

The system maintains complete version history for all prompts:

- **Automatic Versioning**: Every save creates a new revision
- **Version Comparison**: Compare different versions side-by-side
- **Rollback Capability**: Revert to previous versions when needed
- **Branch Management**: Create experimental branches for testing

### Direct Generation from Messages

Convert existing conversation threads into reusable prompts:

```typescript
// Convert message history to prompt template
const convertMessagesToPrompt = (messages: Message[]) => {
  return {
    template: extractTemplate(messages),
    variables: identifyVariables(messages),
    context: preserveContext(messages)
  };
};
```

### Integration with Agent Execution History

The Prompts system integrates deeply with agent workflows:

- **Execution Tracking**: Monitor how prompts perform in agent contexts
- **Performance Analytics**: Track success rates and response quality
- **Automatic Optimization**: Suggest improvements based on usage patterns
- **Context Preservation**: Maintain agent state and conversation history

## API Reference

### Core Prompt Operations

#### Create Prompt
```typescript
POST /api/prompts
Content-Type: application/json

{
  "name": string,
  "template": string,
  "parameters": object,
  "metadata": object
}
```

#### Get Prompt
```typescript
GET /api/prompts/{id}
Response: {
  "id": string,
  "name": string,
  "template": string,
  "parameters": object,
  "metadata": object,
  "version": number,
  "createdAt": string,
  "updatedAt": string
}
```

#### Update Prompt
```typescript
PUT /api/prompts/{id}
Content-Type: application/json

{
  "name": string,
  "template": string,
  "parameters": object,
  "metadata": object
}
```

#### Delete Prompt
```typescript
DELETE /api/prompts/{id}
Response: 204 No Content
```

### Versioning Operations

#### Get Prompt Versions
```typescript
GET /api/prompts/{id}/versions
Response: {
  "versions": [
    {
      "version": number,
      "createdAt": string,
      "changes": string[]
    }
  ]
}
```

#### Get Specific Version
```typescript
GET /api/prompts/{id}/versions/{version}
Response: {
  "id": string,
  "version": number,
  "template": string,
  "parameters": object,
  "metadata": object
}
```

### Studio Operations

#### Execute Prompt
```typescript
POST /api/prompts/{id}/execute
Content-Type: application/json

{
  "variables": object,
  "parameters": object
}

Response: {
  "result": string,
  "metadata": object,
  "executionTime": number
}
```

## Technical Implementation

### Frontend Architecture

The frontend uses Angular with signal-based state management:

```typescript
@Injectable({ providedIn: 'root' })
export class PromptService {
  private http = inject(HttpClient);
  
  // Signal-based state
  private promptsSignal = signal<Prompt[]>([]);
  private loadingSignal = signal<boolean>(false);
  private errorSignal = signal<string | null>(null);

  // Public readonly signals
  prompts = this.promptsSignal.asReadonly();
  loading = this.loadingSignal.asReadonly();
  error = this.errorSignal.asReadonly();

  async loadPrompts() {
    this.loadingSignal.set(true);
    try {
      const prompts = await this.http.get<Prompt[]>('/api/prompts').toPromise();
      this.promptsSignal.set(prompts);
    } catch (error) {
      this.errorSignal.set(error.message);
    } finally {
      this.loadingSignal.set(false);
    }
  }
}
```

### Backend API with TypeBox Validation

The backend uses Fastify with TypeBox for request/response validation:

```typescript
import { Type } from '@sinclair/typebox';
import { FastifyInstance } from 'fastify';

const PromptSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  template: Type.String(),
  parameters: Type.Object({}),
  metadata: Type.Object({})
});

const CreatePromptSchema = Type.Object({
  name: Type.String(),
  template: Type.String(),
  parameters: Type.Optional(Type.Object({})),
  metadata: Type.Optional(Type.Object({}))
});

export async function promptRoutes(fastify: FastifyInstance) {
  // Create prompt
  fastify.post('/prompts', {
    schema: {
      body: CreatePromptSchema,
      response: {
        201: PromptSchema
      }
    }
  }, async (request, reply) => {
    const prompt = await createPrompt(request.body);
    reply.code(201).send(prompt);
  });

  // Get prompt
  fastify.get('/prompts/:id', {
    schema: {
      params: Type.Object({
        id: Type.String()
      }),
      response: {
        200: PromptSchema
      }
    }
  }, async (request, reply) => {
    const prompt = await getPrompt(request.params.id);
    reply.send(prompt);
  });
}
```

### openInPromptStudio() Implementation

The `openInPromptStudio()` function converts LLM calls to prompts:

```typescript
@Component({
  selector: 'app-agent-llm-calls',
  template: `
    <div *ngFor="let call of llmCalls">
      <button (click)="openInPromptStudio(call)">
        Open in Prompt Studio
      </button>
    </div>
  `
})
export class AgentLlmCallsComponent {
  constructor(
    private promptService: PromptService,
    private router: Router
  ) {}

  async openInPromptStudio(llmCall: LlmCall) {
    // Convert LLM call data to prompt format
    const promptData = {
      name: `Prompt from ${llmCall.timestamp}`,
      template: this.extractTemplate(llmCall.messages),
      parameters: {
        model: llmCall.model,
        temperature: llmCall.temperature,
        maxTokens: llmCall.maxTokens,
        ...llmCall.parameters
      },
      metadata: {
        sourceType: 'agent-llm-call',
        sourceId: llmCall.id,
        agentId: llmCall.agentId,
        originalMessages: llmCall.messages,
        timestamp: llmCall.timestamp
      }
    };

    // Create prompt in the system
    const prompt = await this.promptService.createPrompt(promptData);
    
    // Navigate to prompt studio with the new prompt
    this.router.navigate(['/prompt-studio', prompt.id]);
  }

  private extractTemplate(messages: Message[]): string {
    // Convert message history to template format
    return messages
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n\n');
  }
}
```

## Practical Examples

### Example 1: Creating a Code Review Prompt

```typescript
const codeReviewPrompt = {
  name: "Comprehensive Code Review",
  template: `
Please review the following {{language}} code:

\`\`\`{{language}}
{{code}}
\`\`\`

Focus on:
- Code quality and best practices
- Performance considerations
- Security vulnerabilities
- {{additional_focus}}

Provide specific suggestions for improvement.
  `,
  parameters: {
    temperature: 0.3,
    maxTokens: 1500,
    model: "gpt-4"
  },
  metadata: {
    category: "development",
    tags: ["code-review", "quality-assurance"]
  }
};
```

### Example 2: Loading Agent LLM Call

```typescript
// In your agent execution component
async loadLlmCallToPromptLibrary(callId: string) {
  const llmCall = await this.agentService.getLlmCall(callId);
  
  // Preserve all context and settings
  const promptData = {
    name: `Agent Call - ${llmCall.function}`,
    template: this.convertMessagesToTemplate(llmCall.messages),
    parameters: llmCall.modelSettings,
    metadata: {
      sourceAgentId: llmCall.agentId,
      sourceCallId: callId,
      preservedContext: llmCall.context,
      originalTimestamp: llmCall.timestamp
    }
  };

  const savedPrompt = await this.promptService.createPrompt(promptData);
  this.notificationService.success(`Prompt saved: ${savedPrompt.name}`);
}
```

### Example 3: Prompt Studio Experimentation

```typescript
@Component({
  selector: 'app-prompt-studio',
  template: `
    <div class="prompt-editor">
      <textarea [(ngModel)]="currentPrompt.template"></textarea>
      <div class="parameters">
        <input [(ngModel)]="currentPrompt.parameters.temperature" 
               type="range" min="0" max="1" step="0.1">
        <input [(ngModel)]="currentPrompt.parameters.maxTokens" 
               type="number">
      </div>
      <button (click)="testPrompt()">Test Prompt</button>
      <button (click)="saveVersion()">Save Version</button>
    </div>
    <div class="results">
      <pre>{{ testResult }}</pre>
    </div>
  `
})
export class PromptStudioComponent {
  currentPrompt: Prompt;
  testResult: string;

  async testPrompt() {
    this.testResult = await this.promptService.executePrompt(
      this.currentPrompt.id,
      this.getTestVariables(),
      this.currentPrompt.parameters
    );
  }

  async saveVersion() {
    await this.promptService.updatePrompt(this.currentPrompt.id, {
      template: this.currentPrompt.template,
      parameters: this.currentPrompt.parameters
    });
    this.notificationService.success('New version saved');
  }
}
```

## Troubleshooting

### Common Issues

#### Prompt Execution Failures
- **Symptom**: Prompts fail to execute or return errors
- **Solution**: Check model parameters, API keys, and template syntax
- **Debug**: Use the studio's debug mode to see detailed execution logs

#### Version Conflicts
- **Symptom**: Unable to save prompt changes
- **Solution**: Refresh the prompt data and retry, or create a new version
- **Prevention**: Use optimistic locking to prevent concurrent modifications

#### Template Variable Issues
- **Symptom**: Variables not being substituted correctly
- **Solution**: Verify variable names match between template and input data
- **Debug**: Use the template preview feature to validate substitution

#### Performance Issues
- **Symptom**: Slow prompt execution or studio responsiveness
- **Solution**: Optimize prompt templates, reduce token limits, or use faster models
- **Monitoring**: Check execution metrics in the prompt analytics dashboard

### Best Practices

1. **Template Design**: Use clear variable names and provide default values
2. **Version Management**: Create meaningful version descriptions and tags
3. **Testing**: Always test prompts in the studio before production use
4. **Documentation**: Include usage examples and parameter explanations
5. **Security**: Validate all user inputs and sanitize prompt templates
6. **Performance**: Monitor token usage and execution times regularly

### Support and Resources

- **API Documentation**: Complete OpenAPI specification available at `/api/docs`
- **Community Forum**: Join discussions and share prompt templates
- **GitHub Issues**: Report bugs and request features
- **Training Materials**: Video tutorials and best practice guides
