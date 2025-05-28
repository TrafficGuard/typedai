/**
 * Returns the LLM prompt for reformatting text with Markdown tags.
 * @param textToFormat The text to be included in the prompt for formatting.
 * @returns The complete prompt string.
 */
export function getMarkdownFormatPrompt(textToFormat: string): string {
	return `Your task is to reformat the text within the <text-to-format> tags with appropriate Markdown openening and closing tags (\`\`\`). For exapmple
<example-input>
# Title

Introduction to typescript

## Classes

export class Service implements IService {
    constructor() {}

    async foo(): Promise<void> {}
}


In this brief example demonstrates a class definition. We'll use this build pipeline config to build:

build-job:
  stage: built-test
  script:
    - git clone https://github.com/group/project.git
    - npm install
    - npm run test
  tags:
    - docker

This will clone our repo and run the tests

# Conclusion

Building and testing is easy, get ready for the next section
<example-input>
<example-output>
# Title

Introduction to typescript

## Classes

\`\`\`typescript
export class Service implements IService {
    constructor() {}

    async foo(): Promise<void> {}
}
\`\`\`

In this brief example demonstrates a class definition. We'll use this build pipeline config to build:

\`\`\`yaml
build-job:
  stage: built-test
  script:
    - git clone https://github.com/group/project.git
    - npm install
    - npm run test
  tags:
    - docker
\`\`\`

This will clone our repo and run the tests

# Conclusion

Building and testing is easy, get ready for the next section
</example-output>

Your response should only contain the Markdown formatted text and nothing else. Do not include any preamble or explanation.

<text_to_format>
${textToFormat}
</text_to_format>
/nothink`;
}

/*
<example-input>
# Title

Introduction to typescript

## Classes

export class Service implements IService {
    constructor() {}

    async foo(): Promise<void> {}
}


In this brief example demonstrates a class definition. We'll use this build pipeline config to build:

build-job:
  stage: built-test
  script:
    - git clone https://github.com/group/project.git
    - npm install
    - npm run test
  tags:
    - docker

This will clone our repo and run the tests

# Conclusion

Building and testing is easy, get ready for the next section
<example-input>
<example-output>
```markdown
# Title

Introduction to typescript

## Classes
```
```typescript
export class Service implements IService {
    constructor() {}

    async foo(): Promise<void> {}
}
```

In this brief example demonstrates a class definition. We'll use this build pipeline config to build:
```yaml
build-job:
  stage: built-test
  script:
    - git clone https://github.com/group/project.git
    - npm install
    - npm run test
  tags:
    - docker
```
```markdown
This will clone our repo and run the tests

# Conclusion

Building and testing is easy, get ready for the next section
```
</example-output>
 */
