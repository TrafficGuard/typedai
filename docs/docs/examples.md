# Example agent prompts

## Creating the Edit Functions UI component

The following are the prompts used to create the function-edit-modal component to update an agents available functions

> In the agent component on the details tab I want to be able to edit the functions available to the agent, similarly to how I can select them in the run agent component, by clicking on an icon button at the start of the functions list to enable the edit mode. Create a New update functions route which the agent component will call. Only use the CodeEditingAgent_implementUserRequirements function to make changes to files. Think it through and you can make the edits in multiple steps
<!-- -->
> in the agent component in the details tab, can you move the functions edit icon button to the right of the functions list, and have the function editing open in a popup modal
<!-- -->
> can you update the function-edit-modal component to have the full list of functions to select from, like in the runAgent component
<!-- -->
> can you update the function-edit-modal component to have the list sorted alphabetically, with the selected functions first. Also remove the duplicated checkboxes on each row
<!-- -->
> can you update the function-edit-modal component to have a search field that filters the visible functions by a fuzzy match with what entered in the search field, and of course showing all functions if the field is empty
<!-- -->
> can you update the function-edit-modal component to remain the same height when the filter input filters down the list of displayed functions to select

![Edit functions](https://public.trafficguard.ai/typedai/edit-functions.png)

## Adding LLM integration tests tests

Given the initial integration test, this prompt created the tests for the other LLM services

> for all the llm services under src/llm/models add a test to llm.int.ts the same as the anthropic example using the cheapest model available for that service

`n code 'for all the llm services...'`

```typescript
import { expect } from 'chai';
import { Claude3_Haiku } from "#llm/models/anthropic";


describe('LLMs', () => {

    const SKY_PROMPT = 'What colour is the day sky? Answer in one word.'

    describe('Anthropic', () => {
        const llm = Claude3_Haiku();

        it('should generateText', async () => {
            const response = await llm.generateText(SKY_PROMPT, null, {temperature: 0});
            expect(response.toLowerCase()).to.include('blue');
        });
    })
})
```




