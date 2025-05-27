# Goal
Allow users to manually edit, or request AI refinement of the implementation plan before execution.

## OnLoad
- Fetch the CodeTask data
    - Check the status is `design_review_details` or `updating_design`. Otherwise, re-route

# UI

View file selection[link]

Design
[markdown rendered|textarea]

(Edit)[button] | (Save)[button] (Cancel)[button] 

Update design instructions
[textarea]
(submit)[button]

(Implement design)[button]

## Notes

When the user clicks the edit button the design switches from markdown rendered text to a textarea, and the cancel/save buttons show instead of the Edit button.

When the save/submit/implement buttons are clicked there will be a spinner overlay preventing actions while the submission is in progress.
