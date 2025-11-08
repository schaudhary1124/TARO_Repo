const fs = require('fs').promises;
const path = require('path');

// --- CONSTANTS ---
const VERTICAL_LINE = '│   ';
const MIDDLE_ITEM = '├── ';
const LAST_ITEM = '└── ';
const EMPTY_SPACE = '    ';
const OUTPUT_FILENAME = 'aggressively_filtered_project_tree.txt'; // Changed name to reflect aggressive filtering

// Items that do not provide structural understanding or are auto-generated
const IGNORED_ITEMS = [
    // Standard Node.js build/dependency artifacts
    'node_modules',
    'dist',
    'build',
    'out',
    'temp',
    
    // Test/Coverage directories (often contain large mock data/snapshots)
    'test',
    'tests',
    '__tests__',
    'coverage',
    'snapshots',
    
    // Asset/Documentation files
    'assets',        // If large images/media are not essential for structure
    'docs',
    'documentation',
    'images',
    'media',
    'README.md',     // Structure is not dependent on README
    'CHANGELOG.md',
    'LICENSE',
    
    // Data/JSON files (often large mock data)
    'data',
    'mock',
    
    // Lock/Compressed/Compiled files
    'npm-debug.log',
    'yarn-error.log',
    'package-lock.json', // Redundant if package.json is present
    'yarn.lock',         // Redundant if package.json is present
    'logs',
    'zip',
    'rar',
    'tar',
    'wasm', // WebAssembly output
    
    // The script's own output file
    OUTPUT_FILENAME 
];

let outputLines = [];

/**
 * Checks if an item should be ignored for the tree structure.
 * @param {string} item - The filename or directory name.
 * @returns {boolean} - True if the item should be ignored.
 */
function shouldIgnore(item) {
    // 1. Check against the explicit ignore list
    if (IGNORED_ITEMS.includes(item)) {
        return true;
    }
    
    // 2. AGGRESSIVE FILTER: EXCLUDE ALL HIDDEN FILES/FOLDERS (starting with '.')
    // This removes .git, .vscode, .env, .babelrc, .eslintrc, etc.
    // If you MUST keep certain dot-files (like package.json, or specific .env files), 
    // you must explicitly add them to the IGNORED_ITEMS list for them to be skipped 
    // by this check.
    if (item.startsWith('.')) {
        return true;
    }
    
    return false;
}

/**
 * Recursively scans a directory and collects a tree structure into the outputLines array.
 * Includes a filter to exclude build artifacts, dependencies, and editor configs.
 * @param {string} dirPath - The directory path to scan.
 * @param {string} prefix - The prefix string for the current indentation level.
 */
async function printTree(dirPath, prefix = '', isRoot = false) {
    try {
        let items = await fs.readdir(dirPath);
        
        // --- APPLY FILTERING ---
        const filteredItems = items.filter(item => !shouldIgnore(item));
        
        const sortedItems = filteredItems.sort();
        const totalItems = sortedItems.length;

        for (let i = 0; i < totalItems; i++) {
            const item = sortedItems[i];
            const fullPath = path.join(dirPath, item);
            const isLast = (i === totalItems - 1);
            
            // Determine the prefix style for the current item
            const itemPrefix = isLast ? LAST_ITEM : MIDDLE_ITEM;

            outputLines.push(`${prefix}${itemPrefix}${item}`);

            // Check if the item is a directory
            let stats;
            try {
                stats = await fs.stat(fullPath);
            } catch (statError) {
                // Ignore items we can't stat
                continue; 
            }

            if (stats.isDirectory()) {
                // Calculate the new prefix for the subdirectory's contents
                const nextPrefix = prefix + (isLast ? EMPTY_SPACE : VERTICAL_LINE);
                
                // Recurse into the subdirectory
                await printTree(fullPath, nextPrefix);
            }
        }
    } catch (err) {
        // Only show fatal errors
        if (!isRoot || err.code !== 'ENOENT') {
            outputLines.push(`\nError processing directory ${dirPath}: ${err.message}\n`);
        }
    }
}

// --- Main Execution ---
async function main() {
    const startPath = '.'; 
    const startTime = process.hrtime();

    outputLines.push(`Scanning current directory (AGGRESSIVELY FILTERED - Focus on Core Source Files)...\n`);
    outputLines.push(`PROJECT STRUCTURE (AGGRESSIVE FILTER)`); 
    
    await printTree(startPath, '', true);
    
    const endTime = process.hrtime(startTime);
    const durationMs = (endTime[0] * 1000) + (endTime[1] / 1000000);
    
    const conclusion = `\nScan complete. Output saved to: ${OUTPUT_FILENAME} (Took ${durationMs.toFixed(2)}ms)`;
    outputLines.push(conclusion);
    
    try {
        await fs.writeFile(OUTPUT_FILENAME, outputLines.join('\n'));
        console.log(conclusion);
    } catch (writeError) {
        console.error(`\nFATAL ERROR: Could not write file ${OUTPUT_FILENAME}: ${writeError.message}`);
    }
}

main();