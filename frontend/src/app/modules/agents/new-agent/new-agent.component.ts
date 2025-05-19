import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatRadioModule } from '@angular/material/radio';
import { NewAutonomousAgentComponent } from './new-autonomous-agent.component';
import { NewWorkflowsAgentComponent } from '../new-workflows-agent/new-workflows-agent.component';

@Component({
  selector: 'app-new-agent-container',
  templateUrl: './new-agent.component.html',
  styleUrls: ['./new-agent.component.scss'],
  standalone: true,
  imports: [
      CommonModule,
      ReactiveFormsModule,
      MatRadioModule,
      NewAutonomousAgentComponent,
      NewWorkflowsAgentComponent
  ],
})
export class NewAgentComponent implements OnInit {

  agentTypeControl = new FormControl('autonomous');

  constructor() { }

  ngOnInit(): void {
    console.log('NewAgentComponent container initialized. Selector logic added.');
  }
}
````
