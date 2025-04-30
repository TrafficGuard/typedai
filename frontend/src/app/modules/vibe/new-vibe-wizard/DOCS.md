# New Vibe Wizard Requirements

When creating a new vibe session there will be a form.

Title - Text field
Instructions - Textarea
Repository Source - (type of repo) Radio button selection with the options Local, GitHub and GitLab
    The GitHub and GitLab radio buttons will become enabled once the project lists have loaded
    When a radio button is selected it will change the label on the next select field.
Repository project - Select field. Populated depending on the Repository Source selection
    The select label will change between
        Local repository path
        GitHub project
        GitLab project
Target branch - Select field. populated with all the branches from the selected repository

Working branch - Radio buttons. The user has three options for the working branch. 
    1) Use the target branch. 
    2) Use an existing branch - this has a select field to the right containing all the branches of the selected repo
    3) Create a new branch - this has a text field to the right
The default radio selection will be to create a new branch.
There should be validation so a new branch doesn't match an existing branch

## UI Mockup

Title
[text]

Instructions
[textarea]

Repository Source [*] Local [*] GitHub [*] GitLab (GitHub and GitLab only enabled once the project have loaded)

Local repository path/GitHub project/GitLab project
[select]

Target branch
[select]

Working Branch Option
[*] Use target branch
[*] Use existing branch [select]
[*] Create new branch [text]

[x] Clone to shared folder (Only enabled for GitHub and GitLab)