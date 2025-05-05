import { Component, Input } from '@angular/core';
import { AgentContext } from '../../agent.types';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { NgForOf, NgIf, KeyValuePipe } from '@angular/common';

@Component({
    selector: 'agent-memory',
    templateUrl: './agent-memory.component.html',
    standalone: true,
    imports: [
        MatCardModule,
        MatExpansionModule,
        NgForOf,
        NgIf,
        KeyValuePipe,
    ],
})
export class AgentMemoryComponent {
    @Input() agentDetails!: AgentContext | null;

    convertMemoryValue(value: any): string {
        // Stringify the value with pretty printing
        const jsonString = JSON.stringify(value, null, 2);
        // Replace escaped newlines (\\n) from JSON stringification with actual newlines (\n)
        const stringWithNewlines = jsonString.replace(/\\n/g, '\n');
        // Replace actual newlines (\n) with HTML line break tags (<br/>)
        const htmlString = stringWithNewlines.replace(/\n/g, '<br/>');
        return htmlString;
    }

    memoryExpanded: { [key: string]: boolean } = {};

    toggleExpansion(key: string): void {
        this.memoryExpanded[key] = !this.memoryExpanded[key];
    }
}
