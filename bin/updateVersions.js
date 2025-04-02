const fs = require('fs');
const path = require('path');

// Function to update version in a file
function updateVersionInFile(filePath, newVersion) {
    try {
        // Read the existing file
        const data = fs.readFileSync(filePath, 'utf8');
        // Parse JSON
        let jsonData = JSON.parse(data);
        // Update version
        jsonData.version = newVersion;
        // Stringify JSON with indentation to preserve formatting
        const updatedData = JSON.stringify(jsonData, null, 2); // Using 2 spaces for indentation
        // Write the updated data back to the file
        fs.writeFileSync(filePath, updatedData);
        console.log(`Updated version in ${filePath} to ${newVersion}`);
    } catch (error) {
        console.error(`Error updating ${filePath}:`, error.message);
    }
}

// Process command line arguments
if (process.argv.length < 3) {
    console.log('Please provide the new version as an argument.');
    process.exit(1);
}

const newVersion = process.argv[2];

// Specify files to update
const filesToUpdate = [
    path.join(__dirname, 'package.json'),
    path.join(__dirname, 'package-lock.json'),
    path.join(__dirname, 'frontend/package.json'),
    path.join(__dirname, 'frontend/package-lock.json'),
];

// Update version in each file
filesToUpdate.forEach((filePath) => {
    updateVersionInFile(filePath, newVersion);
});